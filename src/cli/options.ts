import type { ColorMode } from '../presentation/colors';

export interface GlobalOptions {
  workspace?: string;
  workspaceRoot?: string;
  json: boolean;
  color: ColorMode;
  quiet: boolean;
  verbose: boolean;
}

export function defaultGlobalOptions(): GlobalOptions {
  return { json: false, color: 'auto', quiet: false, verbose: false };
}
