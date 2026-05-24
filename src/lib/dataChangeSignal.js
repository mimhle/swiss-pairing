export const DATA_CHANGED_EVENT = "swiss-pairing:data-changed";

export function notifyDataChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}
