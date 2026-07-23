import brain from "@/data/master-brain-v2.json";
import type { Workflow } from "@/lib/types";

export const workflows = brain as Workflow[];
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
