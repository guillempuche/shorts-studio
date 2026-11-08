# Video beats

## Why

Every beat is one picture today, which ffmpeg zooms or pans. Posts will start using video too: the user's own footage, and AI clips from `clip animate` (voice-music-animate). Nothing says how a draft uses a clip yet. `post review --animate` marks beats, and voice-music-animate makes clips, but the draft, the CapCut export and the previews only know pictures. This change gives a beat a clip slot that every clip source fills the same way.

## What Changes

- **A beat shows an image or a clip.** `clip import --post <slug> --beat N --file <video>` sets the beat's clip, with these options:
  - `--from <seconds>`: where in the clip to start;
  - `--focus x,y`: where to centre the crop;
  - `--sound mute|under`: what happens to the clip's own sound;
  - `--origin mine|others|ai`: where the video came from.

  A beat with a clip needs no image and no prompt. `draft render`, `capcut export` and `post show`'s next step stop asking for them, and `image generate` skips clip beats unless one is named with `--beat`, so nothing is paid for that the draft won't show. If the beat also has an image, it's kept, but the draft shows the clip. Wherever a still of a clip beat is needed (a preview, a sheet, a cover, a carousel slide), it's the clip's frame at that moment, or at the beat's middle.
- **Converted once, on import.** Phone video comes in many forms, so each clip is converted into a working copy in `clips/` once:
  - turned upright (ffmpeg does this by default);
  - 30 fps at a steady rate, even if the phone's rate varied;
  - normal colour range (SDR);
  - scaled so a 1080×1920 crop fits whole, whatever the clip's shape. A landscape clip keeps only about a third of its width, and a low-resolution clip gets enlarged; `clip import` reports both;
  - only the part that's needed: from `--from` to 60 s later or the clip's end, so a 10-minute 4K file doesn't take minutes to convert. Clips with the same original and start share one working copy.

  HDR footage, which most iPhones record, needs ffmpeg's `zscale` filter. Nix's `ffmpeg-full` has it, but Homebrew's default ffmpeg doesn't. Without it, importing an HDR clip fails with `missing-tool` and says how to get it, and `doctor` warns ahead of time. HDR that `zscale` can't convert is refused with the same kind of message; Dolby Vision without an HLG base layer is a guess to test. A file with no video stream is refused.
- **A clip covers its whole beat**, from `--from`. If it's too short, `clip import` refuses and names the fixes: start earlier, shorten the beat, or `--hold`, which keeps the last frame still for the rest of the beat. `draft render` checks again, because beats can change length later.
- **Cutting the beats again keeps what it can.** `beat plan --by-moment` rebuilds the beats. A clip stays on the new beat that starts on the same frame as its old beat. The others are dropped, and the command names them. Their working copies stay in `clips/`, so `clip import` can put them back.
- **No motion on clips.** Footage already moves, so a clip beat is only cropped, with no zoom or pan. `beat set --motion` on a clip beat is refused. Zooming into a clip (a quick punch-in on a twist) can come later.
- **The clip's own sound is muted by default.** With `--sound under`, it plays quietly under the voice, at a fixed level set in the domain. Sound from a clip with origin `others` is never used, like audio from someone else's reel today, and `capcut export --mute` leaves out every clip's sound too.
- **The draft and the CapCut export use clips.** ffmpeg takes each clip beat's working copy from `--from`, crops it at the focus, and keeps exactly the beat's frames, by the same frame rule as pictures. The CapCut export writes clip beats as their own clips, frame for frame.
- **Someone else's video is flagged.** `post show` and the CapCut export's README name every beat whose clip has origin `others`, because publishing it is the user's responsibility.
- **One slot for every clip source.** `clip animate` (voice-music-animate) fills the same slot with origin `ai`, so drafts, previews and the export need nothing extra for AI clips.
- **The draft's input hash** includes each clip's working copy, start, focus, sound and hold.

This change builds on renderer-text-layers' `Renderer` port.

Not part of this change:
- motion on clips;
- sound ducking (lowering the clip's sound only while someone speaks);
- video carousel slides (TikTok photo mode takes pictures only);
- stock-footage search;
- generating video (`clip animate` stays in voice-music-animate).
