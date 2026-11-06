{
  description = "shorts-studio development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # Spec-driven planning CLI, pinned so every shell gets the same version.
    openspec.url = "github:Fission-AI/OpenSpec/v1.16.0";
  };

  outputs = { self, nixpkgs, flake-utils, openspec }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        # `nix run github:guillempuche/shorts-studio -- doctor`, or `nix profile install`.
        # Node runs the TypeScript source directly, with ffmpeg-full (libass, for burned-in
        # captions) on its PATH. yt-dlp is left to the user: Instagram and TikTok break
        # old versions, and a pinned copy would age with the flake lock.
        packages.default = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "shorts-studio";
          version = (builtins.fromJSON (builtins.readFile ./apps/cli/package.json)).version;

          # Only what the build reads, so docs and the vendored Effect source don't cause rebuilds.
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./pnpm-lock.yaml
              ./pnpm-workspace.yaml
              ./apps
              ./packages
            ];
          };

          nativeBuildInputs = [
            pkgs.nodejs_26
            pkgs.pnpm_12
            pkgs.pnpmConfigHook
            pkgs.makeWrapper
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            pnpm = pkgs.pnpm_12;
            fetcherVersion = 5;
            hash = "sha256-Rpst164ddx21ScatOubp5hcfz+cgoYvkNLR+nNkg/So=";
          };

          # The build sandbox has no network, and pnpm's supply-chain check (pnpm-workspace.yaml)
          # needs the registry. CI's `pnpm install --frozen-lockfile` already enforces that check
          # on every push, so this offline install trusts the lockfile it receives.
          env.pnpm_config_trust_lockfile = "true";

          dontBuild = true;

          installPhase = ''
            runHook preInstall
            pnpm prune --prod --ignore-scripts
            find apps packages -name '*.test.ts' -delete
            mkdir -p $out/lib/shorts-studio
            cp -R package.json node_modules apps packages $out/lib/shorts-studio/
            makeWrapper ${pkgs.nodejs_26}/bin/node $out/bin/shorts-studio \
              --add-flags "--disable-warning=ExperimentalWarning $out/lib/shorts-studio/apps/cli/src/main.ts" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.ffmpeg-full ]}
            runHook postInstall
          '';

          meta = {
            description = (builtins.fromJSON (builtins.readFile ./apps/cli/package.json)).description;
            homepage = "https://github.com/guillempuche/shorts-studio";
            license = pkgs.lib.licenses.asl20;
            mainProgram = "shorts-studio";
            platforms = pkgs.lib.platforms.unix;
          };
        });

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_26
            # Switches itself to the exact version in package.json's `packageManager`.
            pkgs.pnpm_12
            # The full build: draft renders burn captions with the `subtitles` filter, which
            # needs libass and freetype. Common minimal builds (Homebrew's included) lack them.
            pkgs.ffmpeg-full
            openspec.packages.${system}.default
          ];
          # yt-dlp is deliberately absent: Instagram and TikTok break old versions often, so
          # install it yourself and keep it current (`pip install -U yt-dlp`).

          shellHook = ''
            pnpm exec lefthook install >/dev/null 2>&1 || true
            echo "shorts-studio: node $(node --version), pnpm $(pnpm --version 2>/dev/null || echo '?'), $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3), openspec $(openspec --version 2>/dev/null)"
          '';
        };
      });
}
