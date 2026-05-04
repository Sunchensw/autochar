import type { SelectorCandidate, SelectorSet } from '@autochar/shared';

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function selectorCandidateToLocator(candidate: SelectorCandidate, root = 'page'): string {
  switch (candidate.kind) {
    case 'testId':
      return `${root}.getByTestId(${q(candidate.value)})`;
    case 'role': {
      const role = candidate.role || candidate.value;
      const name = candidate.name;
      return name ? `${root}.getByRole(${q(role)}, { name: ${q(name)} })` : `${root}.getByRole(${q(role)})`;
    }
    case 'label':
      return `${root}.getByLabel(${q(candidate.value)})`;
    case 'placeholder':
      return `${root}.getByPlaceholder(${q(candidate.value)})`;
    case 'text':
      return `${root}.getByText(${q(candidate.value)})`;
    case 'name':
      return `${root}.locator(${q(`[name="${candidate.value.replace(/"/g, '\\"')}"]`)})`;
    case 'id':
      return `${root}.locator(${q(`#${candidate.value.replace(/"/g, '\\"')}`)})`;
    case 'css':
      return `${root}.locator(${q(candidate.value)})`;
    default:
      return `${root}.locator(${q(candidate.value)})`;
  }
}

export function selectorSetToLocator(selectorSet: SelectorSet, root = 'page'): string {
  return selectorCandidateToLocator(selectorSet.primary, root);
}
