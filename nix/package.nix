# shorts-studio built from source, with the ffmpeg it needs (libass for burned-in captions) on
# its PATH. yt-dlp is left to the user: Instagram and TikTok break old versions, and a pinned
# copy would age with the flake lock.
{
  lib,
  stdenv,
  nodejs_24,
  pnpm_12,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpmBuildHook,
  makeWrapper,
  ffmpeg-full,
}:
let
  pnpm = pnpm_12;
  manifest = builtins.fromJSON (builtins.readFile ../package.json);
in
stdenv.mkDerivation (finalAttrs: {
  pname = "shorts-studio";
  inherit (manifest) version;

  # Only what the build reads, so docs (and the vendored Effect source) don't trigger rebuilds.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.json
      ../tsconfig.build.json
      ../src
    ];
  };

  nativeBuildInputs = [
    nodejs_24
    pnpm
    pnpmConfigHook
    pnpmBuildHook
    makeWrapper
  ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 5;
    hash = "sha256-/vakQyHuWVTXDnOCYkaelsdcPSH/oJr6MCid/SC1WR0=";
  };

  installPhase = ''
    runHook preInstall
    pnpm prune --prod --ignore-scripts
    mkdir -p $out/lib/shorts-studio
    cp -r dist node_modules package.json $out/lib/shorts-studio/
    makeWrapper ${nodejs_24}/bin/node $out/bin/shorts-studio \
      --add-flags $out/lib/shorts-studio/dist/main.js \
      --prefix PATH : ${lib.makeBinPath [ ffmpeg-full ]}
    runHook postInstall
  '';

  meta = {
    description = manifest.description;
    homepage = "https://github.com/guillempuche/shorts-studio";
    license = lib.licenses.asl20;
    mainProgram = "shorts-studio";
    platforms = lib.platforms.unix;
  };
})
