import type { PlanAction } from '../domain/plan';
import type { ObservedRepository } from '../domain/repository';
import type { Colors } from './colors';
import { renderTable } from './table';

export function renderSyncPlan(actions: PlanAction[], colors: Colors): string {
  const rows: string[][] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'noop':
        rows.push(['NOOP', a.name, '', 'ready']);
        break;
      case 'get':
        rows.push(['GET', a.repository.name, '', a.repository.source]);
        break;
      case 'link':
        rows.push([
          'LINK',
          a.repository.name,
          a.repository.destinationRelativePath,
          `-> ${a.linkTarget}`,
        ]);
        break;
      case 'adopt':
        rows.push([
          'ADOPT',
          a.repository.name,
          a.repository.destinationRelativePath,
          `-> ${a.linkTarget}`,
        ]);
        break;
      case 'relink':
        rows.push([
          'RELINK',
          a.repository.name,
          a.repository.destinationRelativePath,
          `-> ${a.linkTarget}`,
        ]);
        break;
      case 'unlink':
        rows.push(['UNLINK', a.name, a.relativePath, 'prune']);
        break;
      case 'mkdir':
        rows.push(['MKDIR', '-', a.relativePath, '']);
        break;
      case 'rmdir':
        rows.push(['RMDIR', '-', a.relativePath, '']);
        break;
      case 'write':
        rows.push(['WRITE', '-', a.relativePath, 'managed block changed']);
        break;
      case 'conflict':
        rows.push(['CONFLICT', a.name ?? '-', '', a.message]);
        break;
    }
  }
  const header = ['ACTION', 'NAME', 'PATH', 'DETAIL'];
  const widths = [10, 16, 20, 40];
  const colored = rows.map((r) => [colorAction(r[0] ?? '', colors), ...r.slice(1)]);
  return renderTable(
    header.map((name, i) => ({ name, width: widths[i] ?? 10 })),
    colored,
  );
}

function colorAction(action: string, colors: Colors): string {
  switch (action) {
    case 'NOOP':
      return colors.dim(action);
    case 'LINK':
    case 'ADOPT':
      return colors.green(action);
    case 'RELINK':
    case 'WRITE':
    case 'MKDIR':
      return colors.cyan(action);
    case 'UNLINK':
    case 'RMDIR':
      return colors.yellow(action);
    case 'CONFLICT':
    case 'GET':
      return colors.yellow(action);
    default:
      return action;
  }
}

export function renderStatus(
  observed: ObservedRepository[],
  branchInfo: { name: string; branch: string; dirty: boolean }[],
): string {
  const rows: string[][] = [];
  for (const o of observed) {
    const state = classify(o);
    const bi = branchInfo.find((b) => b.name === o.desired.name);
    rows.push([
      o.desired.name,
      state,
      bi?.branch ?? '-',
      bi?.dirty ? 'yes' : 'no',
      o.desired.destinationRelativePath,
      o.desired.source,
    ]);
  }
  return renderTable(
    [
      { name: 'NAME', width: 18 },
      { name: 'STATE', width: 16 },
      { name: 'BRANCH', width: 14 },
      { name: 'DIRTY', width: 6 },
      { name: 'PATH', width: 20 },
      { name: 'SOURCE', width: 40 },
    ],
    rows,
  );
}

function classify(o: ObservedRepository): string {
  if (!o.resolvedSource) return 'missing-source';
  switch (o.destinationKind) {
    case 'missing':
      return 'missing-link';
    case 'symlink':
      if (o.resolvedLinkTarget === o.resolvedSource.sourceRealPath) {
        return o.managedState ? 'ready' : 'adoptable';
      }
      return o.resolvedLinkTarget === undefined ? 'broken-link' : 'wrong-link';
    default:
      return 'occupied';
  }
}
