import { session } from 'electron'

export function setupMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true)
      } else {
        callback(false)
      }
    }
  )

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      return permission === 'media'
    }
  )
}