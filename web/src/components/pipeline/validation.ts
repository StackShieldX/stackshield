/**
 * Graph validation for pipeline definitions.
 *
 * Checks for cycles, required parameters, and structural issues before
 * sending the pipeline to the backend.
 */

import type { Node, Edge } from "@xyflow/react";
import { TOOLS, type ToolNodeData, type ToolName } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Detect cycles using DFS. Returns true if the graph is acyclic.
 */
function isAcyclic(nodeIds: string[], edges: Edge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) {
    color.set(id, WHITE);
  }

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const neighbor of adjacency.get(node) ?? []) {
      const c = color.get(neighbor);
      if (c === GRAY) return false; // back edge = cycle
      if (c === WHITE && !dfs(neighbor)) return false;
    }
    color.set(node, BLACK);
    return true;
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      if (!dfs(id)) return false;
    }
  }
  return true;
}

/**
 * Validate the pipeline graph before running.
 */
export function validatePipeline(
  nodes: Node<ToolNodeData>[],
  edges: Edge[],
): ValidationResult {
  const errors: string[] = [];

  // Must have at least one node
  if (nodes.length === 0) {
    errors.push("Pipeline must have at least one tool node.");
    return { valid: false, errors };
  }

  // Check for cycles
  const nodeIds = nodes.map((n) => n.id);
  if (!isAcyclic(nodeIds, edges)) {
    errors.push("Pipeline contains a cycle. Remove circular connections.");
  }

  // Check required params on each node
  for (const node of nodes) {
    const data = node.data;
    const toolDef = TOOLS[data.tool as ToolName];
    if (!toolDef) {
      errors.push(`Node "${data.label}" has unknown tool "${data.tool}".`);
      continue;
    }

    for (const field of toolDef.fields) {
      if (field.required) {
        const value = (data.params[field.name] ?? "").trim();
        if (!value) {
          errors.push(
            `Node "${data.label}": ${field.label} is required.`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
