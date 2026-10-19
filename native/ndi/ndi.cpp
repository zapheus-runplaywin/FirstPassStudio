// FirstPass Studio - the scene as NDI sources on the network, for the Mac app (desktop/ndi.js).
//
// A Node-API module so it loads in Electron without rebuilding for each version. It loads the NDI
// runtime (libndi.dylib, which NDI Tools or the NDI runtime installer puts in /usr/local/lib) when
// first asked, so it builds without it and reports "not installed" without it. Only the SDK's header
// files (MIT licence) are in sdk/; the runtime itself is NDI's and isn't shipped with Studio.
//
//   available()        -> { ok, version } or { ok: false, error, url }
//   start({ sources: [{ kind: 'fill' | 'key' | 'chroma' | 'alpha', name }], color: '#rrggbb', width, height, rateN, rateD })
//                      -> { ok } or { ok: false, error }
//   frame(buffer, width, height) -> true when taken: the latest picture, BGRA with premultiplied alpha
//   stop()
//   status()           -> { running, sent, late, sources: [{ kind, name, connections }] }
//
// A thread sends every source at the frame rate, repeating the latest picture when nothing has
// changed, so receivers see a steady source. Each kind is made from the one picture:
//   fill   - the scene over black;
//   key    - its alpha as white on black (grey where it's partly see-through);
//   chroma - the scene over a solid colour;
//   alpha  - the scene with its transparency (NDI's BGRA, straight alpha) for receivers that key on it.
// A source nobody is watching isn't converted or sent.

#define NAPI_VERSION 8
#include <node_api.h>

#include "Processing.NDI.Lib.h"

#include <dlfcn.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// ---- Loading the runtime ----

static const NDIlib_v5 *lib = nullptr;
static std::string loadError;

// Tries again each time until it works, so installing NDI Tools while Studio is open is enough.
static bool loadRuntime() {
  if (lib) return true;
  std::vector<std::string> paths;
  for (const char *env : { NDILIB_REDIST_FOLDER, "NDI_RUNTIME_DIR_V5" }) {
    const char *dir = getenv(env);
    if (dir && *dir) paths.push_back(std::string(dir) + "/" + NDILIB_LIBRARY_NAME);
  }
#ifdef __APPLE__
  paths.push_back("/usr/local/lib/" NDILIB_LIBRARY_NAME);
  paths.push_back("/Library/NDI SDK for Apple/lib/macOS/" NDILIB_LIBRARY_NAME);
#endif
  paths.push_back(NDILIB_LIBRARY_NAME); // wherever the system looks
  void *handle = nullptr;
  for (const auto &p : paths) if ((handle = dlopen(p.c_str(), RTLD_LOCAL | RTLD_LAZY))) break;
  if (!handle) {
    loadError = "The NDI runtime isn't installed. Install NDI Tools (free) from ndi.video/tools, then open this page again.";
    return false;
  }
  typedef const NDIlib_v5 *(*Load)(void);
  Load load = (Load)dlsym(handle, "NDIlib_v6_load");
  if (!load) load = (Load)dlsym(handle, "NDIlib_v5_load");
  const NDIlib_v5 *l = load ? load() : nullptr;
  loadError = !l ? "The NDI runtime is too old. Install the latest NDI Tools from ndi.video/tools."
    : !l->is_supported_CPU() ? "NDI doesn't support this Mac's processor."
    : !l->initialize() ? "The NDI runtime wouldn't start." : "";
  if (!loadError.empty()) { dlclose(handle); return false; }
  lib = l;
  return true;
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

// ---- The running output ----

enum Kind { FILL, KEY, CHROMA, ALPHA };

struct Source {
  Kind kind;
  std::string name;
  NDIlib_send_instance_t send = nullptr;
  std::vector<uint8_t> pixels; // the latest picture converted for this source
  uint64_t made = 0;           // which picture that was
  std::atomic<int> connections{0};
};

struct Output {
  std::vector<Source *> sources;
  int width = 0, height = 0, rateN = 50, rateD = 1;
  uint8_t color[3] = { 0, 0, 0 }; // chroma colour, B G R
  std::thread thread;
  std::atomic<bool> stopping{false};
  std::atomic<uint64_t> sent{0}, late{0};

  std::mutex lock;
  std::vector<uint8_t> latest; // the newest picture as it came, premultiplied BGRA
  uint64_t picture = 1;

  ~Output() {
    for (auto *s : sources) {
      if (s->send) lib->send_destroy(s->send);
      delete s;
    }
  }

  void convert(Source *s, const std::vector<uint8_t> &pic) {
    const uint8_t *src = pic.data();
    uint8_t *dst = s->pixels.data();
    const size_t size = pic.size();
    switch (s->kind) {
      case FILL: // premultiplied colour is already the scene over black
        for (size_t i = 0; i < size; i += 4) { memcpy(dst + i, src + i, 3); dst[i + 3] = 255; }
        break;
      case KEY:
        for (size_t i = 0; i < size; i += 4) { uint8_t a = src[i + 3]; dst[i] = dst[i + 1] = dst[i + 2] = a; dst[i + 3] = 255; }
        break;
      case CHROMA:
        for (size_t i = 0; i < size; i += 4) {
          unsigned rest = 255 - src[i + 3];
          for (int c = 0; c < 3; c++) { unsigned v = src[i + c] + (color[c] * rest + 127) / 255; dst[i + c] = v > 255 ? 255 : (uint8_t)v; }
          dst[i + 3] = 255;
        }
        break;
      case ALPHA: // NDI's BGRA isn't premultiplied
        for (size_t i = 0; i < size; i += 4) {
          uint8_t a = src[i + 3];
          if (a == 255 || a == 0) { memcpy(dst + i, src + i, 4); continue; }
          for (int c = 0; c < 3; c++) { unsigned v = (src[i + c] * 255u + a / 2) / a; dst[i + c] = v > 255 ? 255 : (uint8_t)v; }
          dst[i + 3] = a;
        }
        break;
    }
  }

  void run() {
    using clock = std::chrono::steady_clock;
    const auto period = std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>((double)rateD / rateN));
    std::vector<uint8_t> pic;
    uint64_t have = 0;
    auto next = clock::now();
    auto checked = next - std::chrono::seconds(1);
    while (!stopping) {
      next += period;
      auto now = clock::now();
      if (now > next + 2 * period) { late++; next = now; } // fell behind: carry on from now rather than rush
      std::this_thread::sleep_until(next);
      if (stopping) break;

      // Who's watching, about once a second (it's cheap, but needn't be every frame).
      if (clock::now() - checked >= std::chrono::seconds(1)) {
        checked = clock::now();
        for (auto *s : sources) s->connections = lib->send_get_no_connections(s->send, 0);
      }
      bool anyone = false;
      for (auto *s : sources) anyone = anyone || s->connections > 0;
      if (!anyone) continue;

      {
        std::lock_guard<std::mutex> hold(lock);
        if (picture != have) { pic = latest; have = picture; }
      }
      for (auto *s : sources) {
        if (s->connections <= 0) continue;
        if (s->made != have) { convert(s, pic); s->made = have; }
        NDIlib_video_frame_v2_t frame;
        frame.xres = width;
        frame.yres = height;
        frame.FourCC = s->kind == ALPHA ? NDIlib_FourCC_video_type_BGRA : NDIlib_FourCC_video_type_BGRX;
        frame.frame_rate_N = rateN;
        frame.frame_rate_D = rateD;
        frame.picture_aspect_ratio = (float)width / height;
        frame.frame_format_type = NDIlib_frame_format_type_progressive;
        frame.timecode = NDIlib_send_timecode_synthesize;
        frame.p_data = s->pixels.data();
        frame.line_stride_in_bytes = width * 4;
        lib->send_send_video_v2(s->send, &frame);
      }
      sent++;
    }
  }
};

static Output *running = nullptr;

static void stopOutput() {
  if (!running) return;
  Output *o = running;
  running = nullptr;
  o->stopping = true;
  if (o->thread.joinable()) o->thread.join();
  delete o;
}

// ---- Exported functions ----

static napi_value Available(napi_env env, napi_callback_info) {
  if (!loadRuntime()) {
    napi_value r = failure(env, loadError);
    set(env, r, "url", str(env, NDILIB_REDIST_URL));
    return r;
  }
  napi_value r = object(env);
  set(env, r, "ok", boolean(env, true));
  const char *v = lib->version();
  set(env, r, "version", str(env, v ? v : ""));
  return r;
}

static napi_value Start(napi_env env, napi_callback_info cb) {
  size_t argc = 1; napi_value opts;
  napi_get_cb_info(env, cb, &argc, &opts, nullptr, nullptr);
  if (argc < 1) return failure(env, "start() needs { sources, width, height }");
  stopOutput();
  if (!loadRuntime()) return failure(env, loadError);

  Output *o = new Output();
  o->width = (int)getNumber(env, opts, "width");
  o->height = (int)getNumber(env, opts, "height");
  o->rateN = (int)getNumber(env, opts, "rateN");
  o->rateD = (int)getNumber(env, opts, "rateD");
  if (o->width < 16 || o->height < 16 || o->width > 7680 || o->height > 4320 || o->rateN <= 0 || o->rateD <= 0) {
    delete o;
    return failure(env, "That isn't a video format NDI can send.");
  }
  std::string color = getString(env, opts, "color");
  if (color.size() == 7 && color[0] == '#') {
    unsigned long rgb = strtoul(color.c_str() + 1, nullptr, 16);
    o->color[0] = rgb & 255; o->color[1] = (rgb >> 8) & 255; o->color[2] = (rgb >> 16) & 255;
  }
  const size_t size = (size_t)o->width * o->height * 4;
  o->latest.assign(size, 0); // see-through until the scene's first picture

  napi_value list; uint32_t count = 0;
  if (napi_get_named_property(env, opts, "sources", &list) == napi_ok) napi_get_array_length(env, list, &count);
  for (uint32_t i = 0; i < count; i++) {
    napi_value item;
    napi_get_element(env, list, i, &item);
    std::string kind = getString(env, item, "kind");
    Source *s = new Source();
    s->kind = kind == "key" ? KEY : kind == "chroma" ? CHROMA : kind == "alpha" ? ALPHA : FILL;
    s->name = getString(env, item, "name");
    s->pixels.assign(size, 0);
    o->sources.push_back(s);
    NDIlib_send_create_t create;
    create.p_ndi_name = s->name.c_str();
    create.p_groups = nullptr;
    create.clock_video = false; // the thread keeps time, for every source together
    create.clock_audio = false;
    s->send = lib->send_create(&create);
    if (!s->send) {
      std::string name = s->name;
      delete o;
      return failure(env, "Couldn't make the NDI source \"" + name + "\". Is another app already using that name?");
    }
  }
  if (o->sources.empty()) { delete o; return failure(env, "No NDI sources to send."); }

  o->thread = std::thread([o] { o->run(); });
  running = o;
  napi_value r = object(env);
  set(env, r, "ok", boolean(env, true));
  return r;
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
  memcpy(o->latest.data(), data, size);
  o->picture++;
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
    set(env, r, "sent", num(env, (double)running->sent));
    set(env, r, "late", num(env, (double)running->late));
    napi_value list;
    napi_create_array(env, &list);
    uint32_t i = 0;
    for (auto *s : running->sources) {
      napi_value so = object(env);
      set(env, so, "kind", str(env, s->kind == KEY ? "key" : s->kind == CHROMA ? "chroma" : s->kind == ALPHA ? "alpha" : "fill"));
      set(env, so, "name", str(env, s->name));
      set(env, so, "connections", num(env, s->connections));
      napi_set_element(env, list, i++, so);
    }
    set(env, r, "sources", list);
  }
  return r;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
    { "available", nullptr, Available, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "frame", nullptr, Frame, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, sizeof props / sizeof props[0], props);
  // Take the sources off the network if the process exits with them running.
  napi_add_env_cleanup_hook(env, [](void *) { stopOutput(); if (lib) lib->destroy(); }, nullptr);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
