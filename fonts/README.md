# Fonts

The UI targets **Satoshi** (free for web via [Fontshare](https://www.fontshare.com/fonts/satoshi)).
It is **not bundled** — download `Satoshi-Variable.woff2` and drop it here as:

    web/fonts/Satoshi-Variable.woff2

Until then the app renders in the fallback stack (Space Grotesk → Inter → system-ui),
which holds the same geometric-grotesk character. Nothing breaks without the file.

Font binaries are gitignored on purpose (not ours to redistribute in the repo).
