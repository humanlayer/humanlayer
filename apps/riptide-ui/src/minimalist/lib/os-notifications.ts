import { playCommentNotificationSound } from '@/lib/comment-notification-sound'

const KEY = 'hl-min-os-notifications'

export function osNotificationsSupported(): boolean {
	return typeof Notification !== 'undefined'
}

/** On unless you turned it off, and only once the browser grants permission. */
export function osNotificationsEnabled(): boolean {
	return osNotificationsSupported() && Notification.permission === 'granted' && localStorage.getItem(KEY) !== 'off'
}

export function setOsNotificationsEnabled(on: boolean) {
	localStorage.setItem(KEY, on ? 'on' : 'off')
}

/** A sound, then an OS notification that brings the window back and opens `open`. */
export function notifyAway(title: string, body: string, tag: string, open: () => void) {
	playCommentNotificationSound()
	if (!osNotificationsEnabled()) return
	const notification = new Notification(title, { body, tag })
	notification.onclick = () => {
		window.focus()
		notification.close()
		open()
	}
}
