export abstract class BaseDataProvider<T> {
	protected cachedData: T | undefined = undefined
	protected fetchPromise: Promise<T> | undefined = undefined
	protected interval: NodeJS.Timeout

	constructor(refreshSeconds: number) {
		this.interval = setInterval(this.refresh, refreshSeconds * 1000)
		this.interval?.unref?.()
	}

	public abstract refresh(): Promise<T>

	public async get() {
		if (this.cachedData) return this.cachedData
		if (this.fetchPromise) return this.fetchPromise

		this.fetchPromise = this.refresh()
		return this.fetchPromise
	}
}