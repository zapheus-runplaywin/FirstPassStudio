#!/usr/bin/env bash
# Builds the ffmpeg the Mac app bundles, for converting ProRes clips added to the Studio
# scene's media folder into WebM (VP9 with transparency, Opus sound) that the pages can play.
#
# A small static build: ffmpeg under the LGPL (no --enable-gpl or --enable-nonfree, so the
# app may ship it), with libvpx and libopus (both BSD) built in. It needs nothing installed
# on the Mac it runs on. The release workflow runs this on the Apple silicon runner and
# caches the result; run it by hand to try the app with ffmpeg from a checkout:
#   vendor/ffmpeg/build.sh        -> vendor/ffmpeg/ffmpeg
# Needs git, make, a C compiler and pkg-config (Xcode command line tools and Homebrew's
# pkg-config on a Mac; on an Intel or Linux machine also nasm).
#
# Change a version below to update; the workflow's cache is keyed on this file.

set -euo pipefail

FFMPEG_VERSION=n9.0.2
LIBVPX_VERSION=v1.17.0
OPUS_VERSION=v1.6.1

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${FFMPEG_WORK:-$HERE/.build}"
PREFIX="$WORK/prefix"
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
mkdir -p "$WORK" "$PREFIX"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"

# Runs a build step quietly, showing its output only if it fails.
run() {
  local log; log="$(mktemp)"
  "$@" >"$log" 2>&1 || { local code=$?; tail -60 "$log" >&2; rm -f "$log"; return $code; }
  rm -f "$log"
}

fetch() { # repo tag dir
  [ -d "$WORK/$3" ] || git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$2" "https://github.com/$1.git" "$WORK/$3"
}

# libvpx's own guess at the target needs to know the macOS version; name it on Apple silicon.
VPX_TARGET=""
[ "$(uname -s)-$(uname -m)" = Darwin-arm64 ] && VPX_TARGET="--target=arm64-darwin-gcc"

echo "== libvpx $LIBVPX_VERSION"
fetch webmproject/libvpx "$LIBVPX_VERSION" libvpx
(cd "$WORK/libvpx" && run ./configure $VPX_TARGET --prefix="$PREFIX" --enable-static --disable-shared --enable-pic --enable-vp9-highbitdepth \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests && run make -j"$JOBS" && run make install)

echo "== opus $OPUS_VERSION"
fetch xiph/opus "$OPUS_VERSION" opus
run cmake -S "$WORK/opus" -B "$WORK/opus/out" -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON
run cmake --build "$WORK/opus/out" -j "$JOBS"
run cmake --install "$WORK/opus/out"

echo "== ffmpeg $FFMPEG_VERSION"
fetch FFmpeg/FFmpeg "$FFMPEG_VERSION" ffmpeg
# Only what converting a .mov needs: reading QuickTime files with ProRes (or H.264/HEVC) video
# and PCM or AAC sound, and writing WebM with VP9 and Opus. Everything else (other formats,
# network, devices) is left out, so far fewer of FFmpeg's security fixes ever apply to it.
(cd "$WORK/ffmpeg" && run ./configure --prefix="$PREFIX" --pkg-config-flags=--static \
  --disable-autodetect --disable-shared --enable-static --disable-debug --disable-doc \
  --disable-everything --disable-network --disable-ffplay --disable-ffprobe \
  --enable-protocol=file --enable-demuxer=mov --enable-muxer=webm \
  --enable-decoder=prores,h264,hevc,aac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le \
  --enable-libvpx --enable-libopus --enable-encoder=libvpx_vp9,libopus \
  --enable-filter=scale,format,aformat,aresample,null,anull --enable-bsf=vp9_superframe \
  --extra-cflags="-I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib" \
  || { tail -40 ffbuild/config.log >&2; exit 1; })
(cd "$WORK/ffmpeg" && run make -j"$JOBS")

cp "$WORK/ffmpeg/ffmpeg" "$HERE/ffmpeg"
strip "$HERE/ffmpeg" 2>/dev/null || true
version="$("$HERE/ffmpeg" -hide_banner -version)"
echo "${version%%$'\n'*}"
codecs="$("$HERE/ffmpeg" -hide_banner -encoders 2>/dev/null; "$HERE/ffmpeg" -hide_banner -decoders 2>/dev/null)"
for want in libvpx-vp9 libopus prores; do
  grep -q " $want " <<<"$codecs" || { echo "$want is missing from the build" >&2; exit 1; }
done
if grep -q -- '--enable-gpl\|--enable-nonfree' <<<"$version"; then echo "the build isn't LGPL" >&2; exit 1; fi
echo "Built $HERE/ffmpeg"
