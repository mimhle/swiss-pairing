export const DATA_CHANGED_EVENT = "swiss-pairing:data-changed";
export const LOCAL_DATA_UPDATED_AT_KEY = "swiss_local_data_updated_at";

export function notifyDataChanged() {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(LOCAL_DATA_UPDATED_AT_KEY, new Date().toISOString());
    } catch (_) {}
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}
