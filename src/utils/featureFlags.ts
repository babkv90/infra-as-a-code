// Staged-rollout switches for the diagram layout/containment refactor. Each fix in that sequence
// ships behind its own flag so it can be verified against the Terraform golden tests independently
// before the next one lands.
export const FEATURE_FLAGS = {
  ff_derived_containers: true,
  ff_auto_layout: false,
} as const;
