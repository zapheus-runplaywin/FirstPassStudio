// A stand-in NDI runtime for timing-test.js: compressing a frame takes ENCODE_MS, as a busy Mac's
// NDI might, and checks the picture is still the one it was handed when it finishes (every pixel the
// same colour), so a buffer Studio overwrote while NDI was still reading it stops the test.
#include <cstddef>
#include "Processing.NDI.Lib.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>

struct Sender { std::thread job; };

static void encode(const uint8_t *p, size_t n) {
  uint32_t first, mid, last;
  memcpy(&first, p, 4);
  const char *ms = getenv("ENCODE_MS");
  std::this_thread::sleep_for(std::chrono::milliseconds(ms ? atoi(ms) : 10));
  memcpy(&mid, p + n / 2, 4);
  memcpy(&last, p + n - 4, 4);
  if (mid != first || last != first) { fprintf(stderr, "a frame changed while NDI was reading it\n"); abort(); }
}
static NDIlib_send_instance_t create(const NDIlib_send_create_t *) { return (NDIlib_send_instance_t)new Sender(); }
static void destroy(NDIlib_send_instance_t i) { auto *s = (Sender *)i; if (s->job.joinable()) s->job.join(); delete s; }
static int connections(NDIlib_send_instance_t, uint32_t) { return 1; }
static void send(NDIlib_send_instance_t i, const NDIlib_video_frame_v2_t *f) {
  auto *s = (Sender *)i;
  if (s->job.joinable()) s->job.join();
  if (f) encode(f->p_data, (size_t)f->line_stride_in_bytes * f->yres);
}
static void sendAsync(NDIlib_send_instance_t i, const NDIlib_video_frame_v2_t *f) {
  auto *s = (Sender *)i;
  if (s->job.joinable()) s->job.join(); // the frame before is done with once this returns
  if (!f) return;
  const uint8_t *p = f->p_data;
  const size_t n = (size_t)f->line_stride_in_bytes * f->yres;
  s->job = std::thread([p, n] { encode(p, n); });
}
static bool yes() { return true; }
static void nothing() {}
static const char *version() { return "mock"; }

static NDIlib_v5 lib;
extern "C" __attribute__((visibility("default"))) const NDIlib_v5 *NDIlib_v6_load(void) {
  memset(&lib, 0, sizeof lib);
  lib.initialize = yes; lib.destroy = nothing; lib.version = version; lib.is_supported_CPU = yes;
  lib.send_create = create; lib.send_destroy = destroy; lib.send_get_no_connections = connections;
  lib.send_send_video_v2 = send; lib.send_send_video_async_v2 = sendAsync;
  return &lib;
}
