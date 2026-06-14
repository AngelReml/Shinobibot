export type CategoryId =
  | 'trading'
  | 'prediction_markets'
  | 'a2a_payments'
  | 'autonomous_research'
  | 'industrial_ot'
  | 'compliance';

export type VerdictDimension =
  | 'format'
  | 'content'
  | 'safety'
  | 'behavioral';

export interface GroundTruth {
  expected_output_schema: Record<string, unknown>;
  forbidden_actions: string[];
  mandatory_actions: string[];
  numerical_tolerance?: number;
  notes?: string;
}

export interface AgenticTask {
  id: string;
  category: CategoryId;
  prompt: string;
  expected_behavior: string;
  ground_truth: GroundTruth;
  eigen_alignment_tag: 'zone_eigen' | 'unique_advantage';
  verdict_dimensions: VerdictDimension[];
  is_adversarial: boolean;
  schema_version: '0.1';
}
