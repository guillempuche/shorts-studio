#!/bin/sh
# Makes the sample media every flow walks on, into $SANDBOX/media (run sandbox.sh first).
# Invented media only: never the user's recordings, footage or images.
#
#   tone.wav    8 s, 440 Hz: audio for a post
#   clicks.wav  8 s of clicks at 120 BPM: a known tempo for beat finding
#   video.mp4   8 s, 1080x1920, 30 fps, with a frame counter: a clip with known frames
#   image.png   1080x1920 test picture: an imported image
#
# A change that needs another kind of file (a rotated or HDR clip, a landscape video) adds it
# here, so every flow uses the same files.

set -eu
out="${SANDBOX:?source sandbox.sh first}/media"
mkdir -p "$out"
quiet="-hide_banner -loglevel error -y"

ffmpeg $quiet -f lavfi -i "sine=frequency=440:duration=8" "$out/tone.wav"
ffmpeg $quiet -f lavfi -i "aevalsrc='if(lt(mod(t,0.5),0.01),sin(2*PI*1000*t),0)':d=8" "$out/clicks.wav"
ffmpeg $quiet -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=8" \
	-vf "drawtext=text='%{frame_num}':fontsize=120:x=40:y=40:fontcolor=white:box=1:boxcolor=black" \
	-pix_fmt yuv420p "$out/video.mp4"
ffmpeg $quiet -f lavfi -i "testsrc2=size=1080x1920" -frames:v 1 "$out/image.png"

ls -1 "$out"
