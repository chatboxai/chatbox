import platform from '@/packages/platform'

export default class BaseStorage {
    constructor() {}

    public async setItem<T>(key: string, value: T): Promise<void> {
        return platform.setStoreValue(key, value)
    }

    public async getItem<T>(key: string, initialValue: T): Promise<T> {
        let value: any = await platform.getStoreValue(key)
        if (value === undefined || value === null) {
            value = initialValue
            await this.setItem(key, value)
        }
        return value
    }

    public async removeItem(key: string): Promise<boolean> {
        return platform.delStoreValue(key)
    }

    public async getAll(): Promise<{ [key: string]: any }> {
        return platform.getAllStoreValues()
    }

    public async setAll(data: { [key: string]: any }) {
        return platform.setAllStoreValues(data)
    }

    // subscribe(key: string, callback: any, initialValue: any): Promise<void>
}
