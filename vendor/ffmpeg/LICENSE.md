# ffmpeg in FirstPass Studio

The Mac app includes a copy of [FFmpeg](https://ffmpeg.org) to convert ProRes clips added to the
Studio scene's media folder into WebM videos the pages can play. Studio runs it as a separate
program; it isn't linked into Studio.

This copy is built by `build.sh` in this folder from these sources, unchanged:

| Part | Version | Licence | Source |
|---|---|---|---|
| FFmpeg | n8.1.3 | GNU Lesser General Public License 2.1 or later | https://github.com/FFmpeg/FFmpeg |
| libvpx (VP9) | v1.17.0 | BSD 3-clause | https://github.com/webmproject/libvpx |
| libopus | v1.6.1 | BSD 3-clause | https://github.com/xiph/opus |

It's built without `--enable-gpl` or `--enable-nonfree`, so it is LGPL licensed and may be
redistributed. The versions above are the ones in `build.sh`, which is the record if they differ.
To use a different or modified FFmpeg, replace `ffmpeg` in this folder (in the installed app:
FirstPass Studio.app/Contents/Resources/app/vendor/ffmpeg/ffmpeg), or set `ffmpegPath` in the
data folder's config.json to another copy.

The LGPL 2.1 is at https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html.
