import { BuildArtifact } from "bun";

export const generateManifest = (
  outputs: BuildArtifact[],
  buildDirectoryAbsolute: string
) => {
  const manifest = outputs.reduce<Record<string, string>>((accumulator, artifact) => {
    let relativePath = artifact.path.startsWith(buildDirectoryAbsolute)
      ? artifact.path.slice(buildDirectoryAbsolute.length)
      : artifact.path;
    relativePath = relativePath.replace(/^\/+/, "");

    const segments = relativePath.split("/");
    const fileWithHash = segments[segments.length - 1];
    if (!fileWithHash) return accumulator;

    const [baseName] = fileWithHash.split(`.${artifact.hash}.`);

    if (relativePath.includes("svelte/pages")) {
      accumulator[baseName] = artifact.path;
    } else if (relativePath.includes("svelte/indexes")) {
      accumulator[`${baseName}Index`] = `/${relativePath}`;
    } else {
      accumulator[baseName] = `/${relativePath}`;
    }

    return accumulator;
  }, {});

  return manifest;
};
