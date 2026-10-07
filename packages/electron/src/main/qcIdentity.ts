/** Owned-fork identity. Updates remain disabled until a reviewed QC channel exists. */
export const QC_PRODUCT_NAME = "QC Nimbalyst";
export const QC_APP_ID = "com.quantumcreative.nimbalyst";
export const QC_URL_SCHEME = "qc-nimbalyst";
export const QC_UPDATES_ENABLED = false;
export const QC_UPDATE_NOTICE =
  "Automatic updates are disabled for this custom build. Install a reviewed QC release.";
export function isNimbalystDeepLink(url: string): boolean {
  return (
    url.startsWith(`${QC_URL_SCHEME}://`) || url.startsWith("nimbalyst://")
  );
}
export function normalizeNimbalystDeepLink(url: string): string {
  return url.startsWith(`${QC_URL_SCHEME}://`)
    ? "nimbalyst://" + url.slice(QC_URL_SCHEME.length + 3)
    : url;
}
