// FirstPass Studio - output to a Blackmagic DeckLink or UltraStudio, for the Mac app (desktop/decklink.js).
//
// A Node-API module so it loads in Electron without rebuilding for each version. It talks to the
// Desktop Video driver the Blackmagic installer puts in /Library/Frameworks (DeckLinkAPIDispatch.cpp
// loads it when first asked), so it builds without the driver and reports "not installed" without it.
//
//   devices()           -> { ok, version, devices: [{ id, name, externalKeying, internalKeying, modes }] } or { ok: false, error }
//   start({ device, mode, keying: 'external' | 'off', straight, audio })  -> { ok, width, height, frameRate, audio } or { ok: false, error }
//   frame(buffer, width, height) -> true when taken: the latest picture, BGRA with premultiplied alpha
//   audio(buffer)       -> true when taken: the next sound, 48 kHz stereo, 16-bit interleaved
//   stop()
//   status()            -> { running, device, completed, late, dropped, audio, gaps, skipped }
//
// Playback is scheduled: the driver hands back each frame as it's shown and we fill it again with
// the latest picture, so the output keeps running (repeating the last picture) however often the
// scene changes. With the external keyer on, the card sends the picture as fill and its alpha as key.
//
// With audio on, the sound is embedded in the SDI (with fill and key, the fill carries it). Each piece
// is scheduled on the device's own clock, as far behind what it's showing now as the pictures queued
// ahead (the preroll), so sound and picture go out together. If the sound runs dry it starts again that
// far ahead (a gap); if it gets too far ahead (the Mac's sound clock running faster than the device's)
// a piece is skipped.

#define NAPI_VERSION 8
#include <node_api.h>

#include "DeckLinkAPI.h"

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#ifdef __APPLE__
typedef CFStringRef dlstring;
static std::string toStd(CFStringRef s) {
  if (!s) return "";
  std::string out;
  CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(s), kCFStringEncodingUTF8) + 1;
  std::vector<char> buf(size);
  if (CFStringGetCString(s, buf.data(), size, kCFStringEncodingUTF8)) out = buf.data();
  CFRelease(s);
  return out;
}
#else
typedef const char *dlstring;
static std::string toStd(const char *s) {
  std::string out = s ? s : "";
  free((void *)s);
  return out;
}
#endif

// Holds one DeckLink interface and releases it.
template <class T> struct Ref {
  T *p = nullptr;
  Ref() {}
  explicit Ref(T *q) : p(q) {}
  ~Ref() { reset(); }
  Ref(const Ref &) = delete;
  Ref &operator=(const Ref &) = delete;
  void reset() { if (p) p->Release(); p = nullptr; }
  T **out() { reset(); return &p; }
  T *operator->() const { return p; }
  explicit operator bool() const { return p != nullptr; }
  T *take() { T *q = p; p = nullptr; return q; }
};

template <class T> static bool query(IUnknown *from, REFIID iid, Ref<T> &to) {
  return from->QueryInterface(iid, (void **)to.out()) == S_OK && to.p;
}

static std::string deviceId(IDeckLink *dl, int index) {
  Ref<IDeckLinkProfileAttributes> attrs;
  int64_t id = 0;
  if (query(dl, IID_IDeckLinkProfileAttributes, attrs) && attrs->GetInt(BMDDeckLinkPersistentID, &id) == S_OK && id)
    return std::to_string(id);
  return "index-" + std::to_string(index);
}

// ---- Node-API helpers ----

static napi_value str(napi_env env, const std::string &s) { napi_value v; napi_create_string_utf8(env, s.c_str(), s.size(), &v); return v; }
static napi_value num(napi_env env, double d) { napi_value v; napi_create_double(env, d, &v); return v; }
static napi_value boolean(napi_env env, bool b) { napi_value v; napi_get_boolean(env, b, &v); return v; }
static napi_value object(napi_env env) { napi_value v; napi_create_object(env, &v); return v; }
static void set(napi_env env, napi_value o, const char *k, napi_value v) { napi_set_named_property(env, o, k, v); }
static napi_value failure(napi_env env, const std::string &error) {
  napi_value o = object(env);
  set(env, o, "ok", boolean(env, false));
  set(env, o, "error", str(env, error));
  return o;
}
static std::string getString(napi_env env, napi_value o, const char *k) {
  napi_value v; size_t len = 0;
  if (napi_get_named_property(env, o, k, &v) != napi_ok) return "";
  if (napi_get_value_string_utf8(env, v, nullptr, 0, &len) != napi_ok) return "";
  std::string s(len, '\0');
  napi_get_value_string_utf8(env, v, &s[0], len + 1, &len);
  return s;
}
static double getNumber(napi_env env, napi_value o, const char *k) {
  napi_value v; double d = 0;
  if (napi_get_named_property(env, o, k, &v) == napi_ok) napi_get_value_double(env, v, &d);
  return d;
}
static bool getBool(napi_env env, napi_value o, const char *k) {
  napi_value v; bool b = false;
  if (napi_get_named_property(env, o, k, &v) == napi_ok) napi_get_value_bool(env, v, &b);
  return b;
}

// ---- The running output ----

static const BMDTimeScale AUDIO_RATE = 48000;

class Output : public IDeckLinkVideoOutputCallback {
public:
  std::string id, name;
  IDeckLinkOutput *out = nullptr;
  IDeckLinkKeyer *keyer = nullptr;
  std::vector<IDeckLinkMutableVideoFrame *> frames;
  BMDTimeValue duration = 0;
  BMDTimeScale scale = 0;
  int width = 0, height = 0;
  bool straight = false;
  std::atomic<bool> stopping{false};
  std::atomic<uint64_t> completed{0}, late{0}, dropped{0};
  bool audio = false;
  BMDTimeValue audioNext = -1;   // where the next sound goes, in samples on the device's clock
  BMDTimeValue audioLead = 0;    // how far ahead of what's showing now it goes
  uint64_t gaps = 0, skipped = 0;

  std::mutex lock;
  std::vector<uint8_t> latest; // the newest picture, already converted for the card

  ~Output() {
    for (auto *f : frames) f->Release();
    if (keyer) keyer->Release();
    if (out) out->Release();
  }

  // Copies the newest picture into a frame the driver gave back, and schedules it again.
  void refill(IDeckLinkVideoFrame *frame) {
    void *bytes = nullptr;
    if (frame->GetBytes(&bytes) == S_OK && bytes) {
      size_t size = (size_t)frame->GetRowBytes() * frame->GetHeight();
      std::lock_guard<std::mutex> hold(lock);
      if (latest.size() == size) memcpy(bytes, latest.data(), size);
    }
    out->ScheduleVideoFrame(frame, scheduled * duration, duration, scale);
    scheduled++;
  }

  HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(IDeckLinkVideoFrame *frame, BMDOutputFrameCompletionResult result) override {
    if (stopping || result == bmdOutputFrameFlushed) return S_OK;
    completed++;
    if (result == bmdOutputFrameDisplayedLate) { late++; scheduled++; } // skip ahead rather than fall further behind
    else if (result == bmdOutputFrameDropped) { dropped++; scheduled++; }
    refill(frame);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, LPVOID *ppv) override { *ppv = nullptr; return E_NOINTERFACE; }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG n = --refs;
    if (n == 0) delete this;
    return n;
  }

  int64_t scheduled = 0;

private:
  std::atomic<ULONG> refs{1};
};

static Output *running = nullptr;

static void stopOutput() {
  if (!running) return;
  Output *o = running;
  running = nullptr;
  o->stopping = true;
  o->out->StopScheduledPlayback(0, nullptr, 0);
  o->out->SetScheduledFrameCompletionCallback(nullptr);
  if (o->audio) o->out->DisableAudioOutput();
  o->out->DisableVideoOutput();
  if (o->keyer) o->keyer->Disable();
  o->Release();
}

// ---- Exported functions ----

static napi_value Devices(napi_env env, napi_callback_info) {
  Ref<IDeckLinkIterator> it(CreateDeckLinkIteratorInstance());
  if (!it) return failure(env, "Blackmagic Desktop Video isn't installed (or is too old). Install it from blackmagicdesign.com/support, then quit and reopen Studio.");

  napi_value result = object(env), list;
  set(env, result, "ok", boolean(env, true));
  Ref<IDeckLinkAPIInformation> info(CreateDeckLinkAPIInformationInstance());
  dlstring version = nullptr;
  if (info && info->GetString(BMDDeckLinkAPIVersion, &version) == S_OK) set(env, result, "version", str(env, toStd(version)));
  napi_create_array(env, &list);
  set(env, result, "devices", list);

  uint32_t count = 0;
  int index = 0;
  Ref<IDeckLink> dl;
  while (it->Next(dl.out()) == S_OK && dl) {
    int i = index++;
    Ref<IDeckLinkOutput> out;
    if (!query(dl.p, IID_IDeckLinkOutput, out)) continue; // capture only
    napi_value d = object(env);
    dlstring name = nullptr;
    set(env, d, "id", str(env, deviceId(dl.p, i)));
    set(env, d, "name", str(env, dl->GetDisplayName(&name) == S_OK ? toStd(name) : "DeckLink " + std::to_string(i + 1)));
    bool ext = false, internal = false;
    Ref<IDeckLinkProfileAttributes> attrs;
    if (query(dl.p, IID_IDeckLinkProfileAttributes, attrs)) {
      attrs->GetFlag(BMDDeckLinkSupportsExternalKeying, &ext);
      attrs->GetFlag(BMDDeckLinkSupportsInternalKeying, &internal);
    }
    set(env, d, "externalKeying", boolean(env, ext));
    set(env, d, "internalKeying", boolean(env, internal));

    napi_value modes;
    napi_create_array(env, &modes);
    uint32_t m = 0;
    Ref<IDeckLinkDisplayModeIterator> mit;
    if (out->GetDisplayModeIterator(mit.out()) == S_OK && mit) {
      Ref<IDeckLinkDisplayMode> mode;
      while (mit->Next(mode.out()) == S_OK && mode) {
        BMDTimeValue dur = 0; BMDTimeScale sc = 0;
        mode->GetFrameRate(&dur, &sc);
        dlstring mname = nullptr;
        BMDDisplayMode code = mode->GetDisplayMode();
        bool plain = false, keyed = false;
        BMDDisplayMode actual;
        out->DoesSupportVideoMode(bmdVideoConnectionUnspecified, code, bmdFormat8BitBGRA, bmdNoVideoOutputConversion, bmdSupportedVideoModeDefault, &actual, &plain);
        out->DoesSupportVideoMode(bmdVideoConnectionUnspecified, code, bmdFormat8BitBGRA, bmdNoVideoOutputConversion, bmdSupportedVideoModeKeying, &actual, &keyed);
        napi_value mo = object(env);
        set(env, mo, "mode", num(env, code));
        set(env, mo, "name", str(env, mode->GetName(&mname) == S_OK ? toStd(mname) : ""));
        set(env, mo, "width", num(env, mode->GetWidth()));
        set(env, mo, "height", num(env, mode->GetHeight()));
        set(env, mo, "frameRate", num(env, dur ? (double)sc / dur : 0));
        BMDFieldDominance field = mode->GetFieldDominance();
        set(env, mo, "interlaced", boolean(env, field == bmdLowerFieldFirst || field == bmdUpperFieldFirst));
        set(env, mo, "supported", boolean(env, plain));
        set(env, mo, "keying", boolean(env, keyed));
        napi_set_element(env, modes, m++, mo);
      }
    }
    set(env, d, "modes", modes);
    napi_set_element(env, list, count++, d);
  }
  return result;
}

static napi_value Start(napi_env env, napi_callback_info cb) {
  size_t argc = 1; napi_value opts;
  napi_get_cb_info(env, cb, &argc, &opts, nullptr, nullptr);
  if (argc < 1) return failure(env, "start() needs { device, mode }");
  std::string wanted = getString(env, opts, "device");
  BMDDisplayMode wantedMode = (BMDDisplayMode)getNumber(env, opts, "mode");
  std::string keying = getString(env, opts, "keying");

  stopOutput();

  Ref<IDeckLinkIterator> it(CreateDeckLinkIteratorInstance());
  if (!it) return failure(env, "Blackmagic Desktop Video isn't installed.");
  Ref<IDeckLink> dl;
  int index = 0;
  bool found = false;
  while (it->Next(dl.out()) == S_OK && dl) {
    if (deviceId(dl.p, index++) == wanted) { found = true; break; }
  }
  if (!found) return failure(env, "That DeckLink device isn't connected.");

  Ref<IDeckLinkOutput> out;
  if (!query(dl.p, IID_IDeckLinkOutput, out)) return failure(env, "That device has no output.");

  Ref<IDeckLinkDisplayModeIterator> mit;
  Ref<IDeckLinkDisplayMode> mode;
  bool haveMode = false;
  if (out->GetDisplayModeIterator(mit.out()) == S_OK && mit) {
    while (mit->Next(mode.out()) == S_OK && mode) if (mode->GetDisplayMode() == wantedMode) { haveMode = true; break; }
  }
  if (!haveMode) return failure(env, "That video format isn't one the device offers.");

  Output *o = new Output();
  o->id = wanted;
  dlstring name = nullptr;
  o->name = dl->GetDisplayName(&name) == S_OK ? toStd(name) : "DeckLink";
  o->width = (int)mode->GetWidth();
  o->height = (int)mode->GetHeight();
  o->straight = getBool(env, opts, "straight");
  mode->GetFrameRate(&o->duration, &o->scale);
  o->out = out.take();

  auto fail = [&](const std::string &why) { if (o->audio) o->out->DisableAudioOutput(); o->out->DisableVideoOutput(); o->stopping = true; o->Release(); return failure(env, why); };

  if (o->out->EnableVideoOutput(wantedMode, bmdVideoOutputFlagDefault) != S_OK)
    return fail("Couldn't start the output. Is another app (such as Media Express) using it?");

  if (keying == "external" || keying == "internal") {
    Ref<IDeckLinkKeyer> keyer;
    if (!query(dl.p, IID_IDeckLinkKeyer, keyer)) return fail("This device can't key.");
    if (keyer->Enable(keying == "external") != S_OK) return fail(keying == "external" ? "This device can't send fill and key in that format." : "This device can't key in that format.");
    keyer->SetLevel(255);
    o->keyer = keyer.take();
  }

  const int rowBytes = o->width * 4;
  o->latest.assign((size_t)rowBytes * o->height, 0);
  int64_t preroll = 4;
  {
    Ref<IDeckLinkProfileAttributes> attrs;
    int64_t min = 0;
    if (query(dl.p, IID_IDeckLinkProfileAttributes, attrs) && attrs->GetInt(BMDDeckLinkMinimumPrerollFrames, &min) == S_OK && min + 1 > preroll) preroll = min + 1;
  }
  for (int64_t i = 0; i < preroll; i++) {
    IDeckLinkMutableVideoFrame *frame = nullptr;
    if (o->out->CreateVideoFrame(o->width, o->height, rowBytes, bmdFormat8BitBGRA, bmdFrameFlagDefault, &frame) != S_OK || !frame)
      return fail("Couldn't make video frames for the output.");
    void *bytes = nullptr;
    if (frame->GetBytes(&bytes) == S_OK && bytes) memset(bytes, 0, (size_t)rowBytes * o->height);
    o->frames.push_back(frame);
    if (o->out->ScheduleVideoFrame(frame, o->scheduled * o->duration, o->duration, o->scale) != S_OK)
      return fail("Couldn't queue video frames for the output.");
    o->scheduled++;
  }
  // The sound, if asked for: without it (a device that can't) the pictures still go out.
  if (getBool(env, opts, "audio") && o->out->EnableAudioOutput(bmdAudioSampleRate48kHz, bmdAudioSampleType16bitInteger, 2, bmdAudioOutputStreamTimestamped) == S_OK) {
    o->audio = true;
    // As far ahead as the pictures queued, plus a piece's worth (20 ms) for the sound arriving in pieces.
    o->audioLead = (o->scale ? preroll * o->duration * AUDIO_RATE / o->scale : 0) + AUDIO_RATE / 50;
  }
  o->out->SetScheduledFrameCompletionCallback(o);
  if (o->out->StartScheduledPlayback(0, o->scale, 1.0) != S_OK) {
    o->out->SetScheduledFrameCompletionCallback(nullptr);
    return fail("Couldn't start playback on the device.");
  }
  running = o;

  napi_value r = object(env);
  set(env, r, "ok", boolean(env, true));
  set(env, r, "name", str(env, o->name));
  set(env, r, "width", num(env, o->width));
  set(env, r, "height", num(env, o->height));
  set(env, r, "frameRate", num(env, o->duration ? (double)o->scale / o->duration : 0));
  set(env, r, "audio", boolean(env, o->audio));
  return r;
}

static napi_value Audio(napi_env env, napi_callback_info cb) {
  size_t argc = 1; napi_value arg;
  napi_get_cb_info(env, cb, &argc, &arg, nullptr, nullptr);
  if (!running || !running->audio || argc < 1) return boolean(env, false);
  void *data = nullptr; size_t length = 0;
  if (napi_get_buffer_info(env, arg, &data, &length) != napi_ok) return boolean(env, false);
  uint32_t frames = (uint32_t)(length / 4); // 2 channels of 16 bits
  if (!frames) return boolean(env, false);
  Output *o = running;
  BMDTimeValue now = 0; double speed = 0;
  if (o->out->GetScheduledStreamTime(AUDIO_RATE, &now, &speed) != S_OK) return boolean(env, false);
  if (o->audioNext < 0 || o->audioNext < now + AUDIO_RATE / 100) {
    // Starting, or the sound ran dry (under 10 ms left): start again the lead ahead.
    if (o->audioNext >= 0) o->gaps++;
    o->audioNext = now + o->audioLead;
  } else if (o->audioNext > now + o->audioLead + AUDIO_RATE / 8) {
    // More than 125 ms further ahead than it should be: leave this piece out to catch up.
    o->skipped++;
    return boolean(env, true);
  }
  uint32_t written = 0;
  if (o->out->ScheduleAudioSamples(data, frames, o->audioNext, AUDIO_RATE, &written) != S_OK) return boolean(env, false);
  o->audioNext += std::max(written, frames);
  return boolean(env, true);
}

static napi_value Frame(napi_env env, napi_callback_info cb) {
  size_t argc = 3; napi_value args[3];
  napi_get_cb_info(env, cb, &argc, args, nullptr, nullptr);
  if (!running || argc < 3) return boolean(env, false);
  void *data = nullptr; size_t length = 0;
  if (napi_get_buffer_info(env, args[0], &data, &length) != napi_ok) return boolean(env, false);
  int32_t w = 0, h = 0;
  napi_get_value_int32(env, args[1], &w);
  napi_get_value_int32(env, args[2], &h);
  Output *o = running;
  size_t size = (size_t)o->width * o->height * 4;
  if (w != o->width || h != o->height || length < size) return boolean(env, false);

  std::lock_guard<std::mutex> hold(o->lock);
  if (!o->straight) {
    memcpy(o->latest.data(), data, size);
  } else {
    // The pictures come premultiplied (colour already scaled by alpha); some keyers want it straight.
    const uint8_t *src = (const uint8_t *)data;
    uint8_t *dst = o->latest.data();
    for (size_t i = 0; i < size; i += 4) {
      uint8_t a = src[i + 3];
      if (a == 255 || a == 0) { memcpy(dst + i, src + i, 4); continue; }
      for (int c = 0; c < 3; c++) { unsigned v = (src[i + c] * 255u + a / 2) / a; dst[i + c] = v > 255 ? 255 : (uint8_t)v; }
      dst[i + 3] = a;
    }
  }
  return boolean(env, true);
}

static napi_value Stop(napi_env env, napi_callback_info) {
  stopOutput();
  napi_value u; napi_get_undefined(env, &u);
  return u;
}

static napi_value Status(napi_env env, napi_callback_info) {
  napi_value r = object(env);
  set(env, r, "running", boolean(env, running != nullptr));
  if (running) {
    set(env, r, "device", str(env, running->id));
    set(env, r, "name", str(env, running->name));
    set(env, r, "completed", num(env, (double)running->completed));
    set(env, r, "late", num(env, (double)running->late));
    set(env, r, "dropped", num(env, (double)running->dropped));
    set(env, r, "audio", boolean(env, running->audio));
    set(env, r, "gaps", num(env, (double)running->gaps));
    set(env, r, "skipped", num(env, (double)running->skipped));
  }
  return r;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "devices", nullptr, Devices, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "audio", nullptr, Audio, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "frame", nullptr, Frame, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, sizeof props / sizeof props[0], props);
  // Stop the output if the process exits with it running.
  napi_add_env_cleanup_hook(env, [](void *) { stopOutput(); }, nullptr);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
