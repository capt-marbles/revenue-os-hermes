export function getActionKey(actionText: string): string {
  let hash = 0;
  for (let i = 0; i < actionText.length; i++) {
    hash = (hash * 31 + actionText.charCodeAt(i)) >>> 0;
  }
  return `action_${hash.toString(16)}`;
}
