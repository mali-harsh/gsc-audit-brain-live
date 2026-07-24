import brain from "@/data/master-brain-v2.json";
import geoBrain from "@/data/seo-geo-brain.json";
import type { Workflow } from "@/lib/types";

// Both brains share the exact same Workflow schema. They are kept as separate
// source files but merged into one inspectable library. Deterministic data only
// — nothing here is model-generated, so it cannot hallucinate.
export const workflows = [...(brain as Workflow[]), ...(geoBrain as Workflow[])];
export const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

export function workflowSummary(workflow: Workflow) {
  return {
    id: workflow.id,
    title: workflow.title,
    category: workflow.meta.category,
    status: workflow.meta.status,
    handoffs: workflow.meta.handoffs,
    nodeCount: workflow.nodes.length,
    decisionCount: workflow.nodes.filter((node) => node.type === "decision").length,
    terminalCount: workflow.nodes.filter((node) => node.type === "terminal").length,
  };
}
