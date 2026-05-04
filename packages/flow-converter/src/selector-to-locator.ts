import type { SelectorCandidate, SelectorSet } from '@autochar/shared';

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function selectorCandidateToLocator(candidate: SelectorCandidate): string {
  switch (candidate.kind) {
    case 'testId':
      return `page.getByTestId(${q(candidate.value)})`;
    case 'role': {
      const role = candidate.role || candidate.value;
      const name = candidate.name;
      return name ? `page.getByRole(${q(role)}, { name: ${q(name)} })` : `page.getByRole(${q(role)})`;
    }
    case 'label':
      return `page.getByLabel(${q(candidate.value)})`;
    case 'placeholder':
      return `page.getByPlaceholder(${q(candidate.value)})`;
    case 'text':
      return `page.getByText(${q(candidate.value)})`;
    case 'name':
      return `page.locator(${q(`[name="${candidate.value.replace(/"/g, '\\"')}"]`)})`;
    case 'id':
      return `page.locator(${q(`#${candidate.value.replace(/"/g, '\\"')}`)})`;
    case 'css':
      return `page.locator(${q(candidate.value)})`;
    default:
      return `page.locator(${q(candidate.value)})`;
  }
}

export function selectorSetToLocator(selectorSet: SelectorSet): string {
  return selectorCandidateToLocator(selectorSet.primary);
}
