import { create } from 'zustand'

export type BillingBannerType = 'trial' | 'trial_ended' | 'past_due' | 'unpaid'

interface BillingBannerState {
	dismissedBanners: Set<BillingBannerType>
	dismiss: (banner: BillingBannerType) => void
	isDismissed: (banner: BillingBannerType) => boolean
	reset: () => void
}

export const useBillingBannerStore = create<BillingBannerState>((set, get) => ({
	dismissedBanners: new Set(),
	dismiss: (banner) =>
		set((state) => ({
			dismissedBanners: new Set([...state.dismissedBanners, banner]),
		})),
	isDismissed: (banner) => get().dismissedBanners.has(banner),
	reset: () => set({ dismissedBanners: new Set() }),
}))
