/** QC has no approved cloud collector or collaboration service yet. */
export const QC_UPSTREAM_TELEMETRY_ENABLED = false;
export const QC_CLOUD_COLLABORATION_ENABLED = false;
export const QC_COLLABORATION_NOTICE = 'Cloud collaboration is not configured for QC Nimbalyst. Local work and Venture OS workspace access remain available.';
export function requireQcCloudCollaboration(): void {
  if (!QC_CLOUD_COLLABORATION_ENABLED) throw new Error(QC_COLLABORATION_NOTICE);
}
