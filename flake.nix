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
        # `nix run github:guillempuche/shorts-studio -- config show`, or `nix profile install`.
        packages.default = pkgs.callPackage ./nix/package.nix { };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
            # The full build: draft renders burn captions with the `subtitles` filter, which
            # needs libass and freetype. Common minimal builds (Homebrew's included) lack them.
            pkgs.ffmpeg-full
            openspec.packages.${system}.default
          ];
          # yt-dlp is deliberately absent: Instagram and TikTok break old versions often, so
          # install it yourself and keep it current (`pip install -U yt-dlp`).

          shellHook = ''
            # pnpm comes from corepack, at the version package.json's `packageManager` names,
            # in a repo-local directory because Nix's node is read-only.
            export COREPACK_HOME="$PWD/.corepack"
            mkdir -p "$COREPACK_HOME/bin"
            export PATH="$COREPACK_HOME/bin:$PATH"
            corepack enable --install-directory "$COREPACK_HOME/bin" 2>/dev/null || true
            pnpm exec lefthook install >/dev/null 2>&1 || true
            echo "shorts-studio: node $(node --version), pnpm $(pnpm --version 2>/dev/null || echo '?'), $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3), openspec $(openspec --version 2>/dev/null)"
          '';
        };
      });
}
