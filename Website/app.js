const listingName = document.getElementById("listingName");
const listingDescription = document.getElementById("listingDescription");
const listingAuthor = document.getElementById("listingAuthor");
const listingInfoLink = document.getElementById("listingInfoLink");
const bannerImage = document.getElementById("bannerImage");
const vccUrlField = document.getElementById("vccUrlField");
const vccAddRepoButton = document.getElementById("vccAddRepoButton");
const vccUrlFieldCopy = document.getElementById("vccUrlFieldCopy");
const urlBarHelp = document.getElementById("urlBarHelp");
const addListingToVccHelp = document.getElementById("addListingToVccHelp");
const searchInput = document.getElementById("searchInput");
const packageGrid = document.getElementById("packageGrid");
const emptyState = document.getElementById("emptyState");
const packageInfoModal = document.getElementById("packageInfoModal");
const packageInfoName = document.getElementById("packageInfoName");
const packageInfoId = document.getElementById("packageInfoId");
const packageInfoVersion = document.getElementById("packageInfoVersion");
const packageInfoDescription = document.getElementById("packageInfoDescription");
const packageInfoAuthor = document.getElementById("packageInfoAuthor");
const packageInfoKeywordsBlock = document.getElementById("packageInfoKeywordsBlock");
const packageInfoKeywords = document.getElementById("packageInfoKeywords");
const packageInfoDependenciesBlock = document.getElementById("packageInfoDependenciesBlock");
const packageInfoDependencies = document.getElementById("packageInfoDependencies");
const packageInfoLicenseBlock = document.getElementById("packageInfoLicenseBlock");
const packageInfoLicense = document.getElementById("packageInfoLicense");
const packageInfoDownload = document.getElementById("packageInfoDownload");
const packageInfoListingHelp = document.getElementById("packageInfoListingHelp");

function compareVersions(leftVersion, rightVersion) {
  const leftMatch = leftVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  const rightMatch = rightVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!leftMatch || !rightMatch) {
    return leftVersion.localeCompare(rightVersion);
  }

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference !== 0) {
      return difference;
    }
  }

  const leftPrerelease = leftMatch[4] ? leftMatch[4].split(".") : [];
  const rightPrerelease = rightMatch[4] ? rightMatch[4].split(".") : [];
  if (leftPrerelease.length === 0 && rightPrerelease.length > 0) {
    return 1;
  }
  if (leftPrerelease.length > 0 && rightPrerelease.length === 0) {
    return -1;
  }

  for (let index = 0; index < Math.max(leftPrerelease.length, rightPrerelease.length); index += 1) {
    const leftPart = leftPrerelease[index];
    const rightPart = rightPrerelease[index];
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

function newestVersion(versionMap) {
  return Object.keys(versionMap).sort((left, right) => compareVersions(right, left))[0];
}

function openDialog(dialog) {
  dialog.showModal();
}

function addListingToVcc(listingUrl) {
  window.location.assign(`vcc://vpm/addRepo?url=${encodeURIComponent(listingUrl)}`);
}

async function copyValue(input, button) {
  await navigator.clipboard.writeText(input.value);
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = "Copy";
  }, 1000);
}

function createTextElement(tagName, className, value) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = value;
  return element;
}

function renderPackageDetails(packageId, packageManifest) {
  packageInfoId.textContent = packageId;
  packageInfoName.textContent = packageManifest.displayName;
  packageInfoVersion.textContent = `Version ${packageManifest.version}`;
  packageInfoDescription.textContent = packageManifest.description;
  packageInfoAuthor.textContent = packageManifest.author.name;
  packageInfoAuthor.href = packageManifest.author.url;
  packageInfoDownload.href = packageManifest.url;

  packageInfoKeywords.replaceChildren();
  const keywords = packageManifest.keywords ?? [];
  packageInfoKeywordsBlock.classList.toggle("hidden", keywords.length === 0);
  for (const keyword of keywords) {
    packageInfoKeywords.append(createTextElement("span", "badge", keyword));
  }

  packageInfoDependencies.replaceChildren();
  const dependencies = { ...packageManifest.dependencies, ...packageManifest.vpmDependencies };
  const dependencyEntries = Object.entries(dependencies);
  packageInfoDependenciesBlock.classList.toggle("hidden", dependencyEntries.length === 0);
  for (const [dependencyName, versionRange] of dependencyEntries) {
    packageInfoDependencies.append(createTextElement("li", "", `${dependencyName} ${versionRange}`));
  }

  const licenseText = packageManifest.license ?? "";
  const licenseUrl = packageManifest.licensesUrl ?? "";
  packageInfoLicenseBlock.classList.toggle("hidden", licenseText.length === 0 && licenseUrl.length === 0);
  packageInfoLicense.textContent = licenseText || "View license";
  if (licenseUrl) {
    packageInfoLicense.href = licenseUrl;
  } else {
    packageInfoLicense.removeAttribute("href");
  }

  packageInfoListingHelp.onclick = () => openDialog(addListingToVccHelp);
  packageInfoModal.showModal();
}

function renderPackages(listing) {
  packageGrid.replaceChildren();
  const packageEntries = Object.entries(listing.packages);

  for (const [packageId, packageListing] of packageEntries) {
    const version = newestVersion(packageListing.versions);
    const packageManifest = packageListing.versions[version];
    const card = document.createElement("article");
    card.className = "packageCard";
    card.dataset.search = `${packageId} ${packageManifest.displayName} ${packageManifest.description}`.toLowerCase();

    const cardHeader = document.createElement("div");
    cardHeader.className = "packageHeader";
    cardHeader.append(
      createTextElement("h2", "packageName", packageManifest.displayName),
      createTextElement("span", "packageVersion", `v${packageManifest.version}`),
    );
    card.append(cardHeader);
    card.append(createTextElement("p", "packageDescription", packageManifest.description));
    card.append(createTextElement("p", "caption2", packageId));

    const actions = document.createElement("div");
    actions.className = "packageActions";
    const addButton = createTextElement("button", "secondaryButton", "Add to VCC");
    addButton.type = "button";
    addButton.onclick = () => addListingToVcc(listing.url);
    const detailsButton = createTextElement("button", "secondaryButton", "Details");
    detailsButton.type = "button";
    detailsButton.onclick = () => renderPackageDetails(packageId, packageManifest);
    const downloadLink = createTextElement("a", "secondaryButton", "Download ZIP");
    downloadLink.href = packageManifest.url;
    downloadLink.target = "_blank";
    downloadLink.rel = "noopener";
    actions.append(addButton, detailsButton, downloadLink);
    card.append(actions);
    packageGrid.append(card);
  }

  filterPackages();
}

function filterPackages() {
  const query = searchInput.value.trim().toLowerCase();
  let visibleCount = 0;
  for (const card of packageGrid.children) {
    const visible = card.dataset.search.includes(query);
    card.hidden = !visible;
    visibleCount += visible ? 1 : 0;
  }
  emptyState.classList.toggle("hidden", visibleCount !== 0 || packageGrid.children.length === 0);
}

function renderListing(listing) {
  document.title = listing.name;
  listingName.textContent = listing.name;
  listingDescription.textContent = listing.description;
  listingAuthor.textContent = listing.author;
  listingAuthor.href = listing.authorUrl;
  listingAuthor.title = listing.authorEmail;
  vccUrlField.value = listing.url;

  if (listing.infoLink) {
    listingInfoLink.textContent = listing.infoLink.text;
    listingInfoLink.href = listing.infoLink.url;
    listingInfoLink.classList.remove("hidden");
  }
  if (listing.bannerUrl) {
    bannerImage.style.backgroundImage = `url("${new URL(listing.bannerUrl, document.baseURI)}")`;
    bannerImage.classList.remove("hidden");
    bannerImage.setAttribute("aria-hidden", "false");
  }

  vccAddRepoButton.onclick = () => addListingToVcc(listing.url);
  vccUrlFieldCopy.onclick = () => copyValue(vccUrlField, vccUrlFieldCopy);
  urlBarHelp.onclick = () => openDialog(addListingToVccHelp);
  searchInput.oninput = filterPackages;
  renderPackages(listing);
}

const response = await fetch("index.json", { cache: "no-store" });
if (!response.ok) {
  throw new Error(`Could not load index.json: HTTP ${response.status}`);
}
renderListing(await response.json());
