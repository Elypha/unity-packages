import { mkdir, readdir, unlink } from "node:fs/promises";

const REGISTRY_DIRECTORY = "registry";
const WEBSITE_INDEX = "Website/index.json";
const VPM_RELEASE_ASSET = "vpm-release.json";
const RETAINED_VERSIONS = 20;
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

type PackageManifest = {
  name: string;
  version: string;
  url: string;
  [key: string]: unknown;
};

type ReleaseEnvelope = {
  schemaVersion: number;
  source: {
    repository: string;
    tag: string;
    asset: string;
  };
  package: PackageManifest;
};

type SourceAuthor = {
  name: string;
  email: string;
  url: string;
};

type SourceMetadata = {
  sources: Record<string, string>;
  author: SourceAuthor;
  [key: string]: unknown;
};

type VersionMap = Map<string, PackageManifest>;
type Registry = Map<string, VersionMap>;

type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const source = await Bun.file("source.json").json() as SourceMetadata;

function parseSemVer(version: string): SemVer {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    throw new Error(`Invalid package version for SemVer retention: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemVer(leftVersion: string, rightVersion: string): number {
  const left = parseSemVer(leftVersion);
  const right = parseSemVer(rightVersion);

  for (const [leftPart, rightPart] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ]) {
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) {
    return 1;
  }
  if (left.prerelease.length > 0 && right.prerelease.length === 0) {
    return -1;
  }

  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }

    const leftIsNumeric = /^\d+$/.test(leftPart);
    const rightIsNumeric = /^\d+$/.test(rightPart);
    if (leftIsNumeric && rightIsNumeric) {
      return Number(leftPart) - Number(rightPart);
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }
    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

function versionsNewestFirst(versions: Iterable<string>): string[] {
  return [...versions].sort((left, right) => {
    const semVerOrder = compareSemVer(right, left);
    return semVerOrder === 0 ? right.localeCompare(left) : semVerOrder;
  });
}

function fragmentPath(packageId: string, version: string): string {
  return `${REGISTRY_DIRECTORY}/${packageId}/${version}.json`;
}

async function loadRegistry(): Promise<Registry> {
  const registry: Registry = new Map();
  const packageDirectories = await readdir(REGISTRY_DIRECTORY, { withFileTypes: true });

  for (const packageDirectory of packageDirectories) {
    if (!packageDirectory.isDirectory()) {
      continue;
    }

    const versions: VersionMap = new Map();
    const fragments = await readdir(`${REGISTRY_DIRECTORY}/${packageDirectory.name}`, { withFileTypes: true });
    for (const fragment of fragments) {
      if (!fragment.isFile() || !fragment.name.endsWith(".json")) {
        continue;
      }

      const version = fragment.name.slice(0, -5);
      const packageManifest = await Bun.file(fragmentPath(packageDirectory.name, version)).json() as PackageManifest;
      versions.set(version, packageManifest);
    }

    registry.set(packageDirectory.name, versions);
  }

  return registry;
}

function githubHeaders(): Headers {
  const headers = new Headers(GITHUB_API_HEADERS);
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function jsonResponse(response: Response, context: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchReleasePackage(sourceRepository: string, releaseTag: string, packageId: string): Promise<PackageManifest> {
  const headers = githubHeaders();
  const releaseResponse = await fetch(
    `https://api.github.com/repos/${sourceRepository}/releases/tags/${encodeURIComponent(releaseTag)}`,
    { headers },
  );
  const release = await jsonResponse(releaseResponse, `Release lookup for ${sourceRepository}@${releaseTag}`) as {
    tag_name: string;
    assets: Array<{ name: string; url: string; browser_download_url: string }>;
  };

  if (release.tag_name !== releaseTag) {
    throw new Error(`Release tag mismatch: expected ${releaseTag}, received ${release.tag_name}`);
  }

  const manifestAssets = release.assets.filter(asset => asset.name === VPM_RELEASE_ASSET);
  if (manifestAssets.length !== 1) {
    throw new Error(`Expected exactly one ${VPM_RELEASE_ASSET} asset in ${sourceRepository}@${releaseTag}`);
  }

  const manifestHeaders = githubHeaders();
  manifestHeaders.set("Accept", "application/octet-stream");
  const manifestResponse = await fetch(manifestAssets[0].url, { headers: manifestHeaders });
  const envelope = await jsonResponse(manifestResponse, `${VPM_RELEASE_ASSET} download for ${sourceRepository}@${releaseTag}`) as ReleaseEnvelope;

  if (envelope.schemaVersion !== 1) {
    throw new Error(`Unsupported ${VPM_RELEASE_ASSET} schema version: ${envelope.schemaVersion}`);
  }
  if (envelope.source.repository !== sourceRepository) {
    throw new Error(`Release manifest repository mismatch: expected ${sourceRepository}, received ${envelope.source.repository}`);
  }
  if (envelope.source.tag !== releaseTag) {
    throw new Error(`Release manifest tag mismatch: expected ${releaseTag}, received ${envelope.source.tag}`);
  }
  if (envelope.package.name !== packageId) {
    throw new Error(`Release manifest package mismatch: expected ${packageId}, received ${envelope.package.name}`);
  }
  if (!releaseTag.startsWith("v") || envelope.package.version !== releaseTag.slice(1)) {
    throw new Error(`Release manifest version ${envelope.package.version} does not match tag ${releaseTag}`);
  }

  const zipAssets = release.assets.filter(asset => asset.name === envelope.source.asset);
  if (zipAssets.length !== 1 || !envelope.source.asset.endsWith(".zip")) {
    throw new Error(`Expected exactly one ZIP asset named ${envelope.source.asset} in ${sourceRepository}@${releaseTag}`);
  }

  const expectedZipUrl = `https://github.com/${sourceRepository}/releases/download/${releaseTag}/${envelope.source.asset}`;
  if (zipAssets[0].browser_download_url !== expectedZipUrl || envelope.package.url !== expectedZipUrl) {
    throw new Error(`Release manifest ZIP URL does not match ${sourceRepository}@${releaseTag}/${envelope.source.asset}`);
  }

  return envelope.package;
}

async function ingestRelease(registry: Registry, sourceRepository: string, releaseTag: string): Promise<void> {
  const packageId = source.sources[sourceRepository];
  if (!packageId) {
    throw new Error(`Source repository is not allowlisted: ${sourceRepository}`);
  }

  const packageManifest = await fetchReleasePackage(sourceRepository, releaseTag, packageId);
  const versions = registry.get(packageId) ?? new Map<string, PackageManifest>();
  const existing = versions.get(packageManifest.version);

  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(packageManifest)) {
      throw new Error(`Refusing to overwrite registry history for ${packageId}@${packageManifest.version}`);
    }
  } else {
    await mkdir(`${REGISTRY_DIRECTORY}/${packageId}`, { recursive: true });
    await Bun.write(fragmentPath(packageId, packageManifest.version), `${JSON.stringify(packageManifest, null, 2)}\n`);
    versions.set(packageManifest.version, packageManifest);
  }

  registry.set(packageId, versions);
}

async function prunePackage(packageId: string, versions: VersionMap): Promise<void> {
  const retainedVersions = new Set(versionsNewestFirst(versions.keys()).slice(0, RETAINED_VERSIONS));
  for (const [version] of versions) {
    if (retainedVersions.has(version)) {
      continue;
    }

    await unlink(fragmentPath(packageId, version));
    versions.delete(version);
  }
}

async function writeListing(registry: Registry): Promise<void> {
  const packages: Record<string, { versions: Record<string, PackageManifest> }> = {};
  for (const packageId of [...registry.keys()].sort()) {
    const versions = registry.get(packageId)!;
    const listingVersions: Record<string, PackageManifest> = {};
    for (const version of versionsNewestFirst(versions.keys())) {
      listingVersions[version] = versions.get(version)!;
    }
    packages[packageId] = { versions: listingVersions };
  }

  const { sources: _allowlist, author, ...listingMetadata } = source;
  const listing = {
    ...listingMetadata,
    author: author.name,
    authorEmail: author.email,
    authorUrl: author.url,
    packages,
  };
  await Bun.write(WEBSITE_INDEX, `${JSON.stringify(listing, null, 2)}\n`);
}

function eventInputs(): { sourceRepository?: string; releaseTag?: string } {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length === 0) {
    return {};
  }
  if (argumentsList.length !== 4 || argumentsList[0] !== "--source-repository" || argumentsList[2] !== "--release-tag") {
    throw new Error("Usage: bun scripts/build-listing.ts [--source-repository <repository> --release-tag <tag>]");
  }

  return {
    sourceRepository: argumentsList[1],
    releaseTag: argumentsList[3],
  };
}

await mkdir(REGISTRY_DIRECTORY, { recursive: true });
const registry = await loadRegistry();
const { sourceRepository, releaseTag } = eventInputs();

if (sourceRepository || releaseTag) {
  if (!sourceRepository || !releaseTag) {
    throw new Error("Both source_repository and release_tag are required for release ingestion");
  }
  await ingestRelease(registry, sourceRepository, releaseTag);
}

for (const [packageId, versions] of registry) {
  await prunePackage(packageId, versions);
}

await writeListing(registry);
