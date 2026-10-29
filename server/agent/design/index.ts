// Curialy design intelligence: a design knowledge base retrieved per request, a per-run design
// brief, and a design audit measured in the cloud browser. See docs/design-intelligence.md.

export { auditPage, auditText, blockingFindings, contrast } from "./audit";
export { buildBrief, designBriefFor, renderBrief } from "./brief";
export { collectorScript, COLLECT_DEFAULTS } from "./collector";
export { allowedLooks, analyzeRequest } from "./intent";
export { KNOWLEDGE } from "./knowledge";
export { isUiSource, uiChanges, uiFingerprint, type PrintCache } from "./workspace";
export type { BriefRole, DesignAudit, DesignBrief, DesignIntent, Finding, PageFacts, WorkspaceFacts } from "./types";
