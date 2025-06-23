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

    if (relativePath.includes("svelte/pages")) {
      const segments = relativePath.split("/");
      const fileWithHash = segments[segments.length - 1];
      if (!fileWithHash) return accumulator;
      const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
      accumulator[`${baseName}/page`] = artifact.path;

      return accumulator;
    }

    if (relativePath.includes("svelte/indexes")) {
      const segments = relativePath.split("/");
      const fileWithHash = segments[segments.length - 1];
      if (!fileWithHash) return accumulator;
      const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
      accumulator[`${baseName}/index`] = `/${relativePath}`;

      return accumulator;
    }

    const segments = relativePath.split("/");
    const fileWithHash = segments[segments.length - 1];
    if (!fileWithHash) return accumulator;
    const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
    accumulator[baseName] = `/${relativePath}`;

    return accumulator;
  }, {});

  return manifest;
};
