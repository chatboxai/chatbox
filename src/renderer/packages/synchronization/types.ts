interface ListRes{
    list: string[]
    hasMore: boolean
}

export const maxSyncTimeout: number = 3000
export const SyncStatus = {
    NeedSync:"NeedSync",
    InProgress: "InProgress",
    Finished: "Finished",
}