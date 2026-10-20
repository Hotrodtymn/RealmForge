ObjC.import('Foundation')

function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function fileExists(path) {
  return ObjC.unwrap($.NSFileManager.defaultManager.fileExistsAtPath($(path)))
}

function resourceLauncherPath(resourcePath) {
  var candidate = resourcePath + '/launcher/macos/realmforge.sh'
  return fileExists(candidate) ? candidate : null
}

function launcherPathForArgument(argument) {
  var path = String(argument)
  var scriptsMarker = '/Contents/Resources/Scripts/'
  var scriptsIndex = path.indexOf(scriptsMarker)
  if (scriptsIndex >= 0) {
    var appPath = path.substring(0, scriptsIndex)
    var bundled = resourceLauncherPath(appPath + '/Contents/Resources')
    if (bundled) return bundled
  }

  var appIndex = path.indexOf('.app')
  if (appIndex >= 0) {
    var appBundlePath = path.substring(0, appIndex + 4)
    var appResources = resourceLauncherPath(appBundlePath + '/Contents/Resources')
    if (appResources) return appResources
  }

  if (path.endsWith('/RealmForge.js') || path.endsWith('/RealmForge-Stop.js')) {
    var sourcePath = path.substring(0, path.lastIndexOf('/') + 1) + 'realmforge.sh'
    if (fileExists(sourcePath)) return sourcePath
  }
  return null
}

function launcherPath(argv) {
  var mainBundlePath = ObjC.unwrap($.NSBundle.mainBundle.bundlePath)
  var appIndex = mainBundlePath.indexOf('.app')
  if (appIndex >= 0) {
    var fromBundle = resourceLauncherPath(mainBundlePath.substring(0, appIndex + 4) + '/Contents/Resources')
    if (fromBundle) return fromBundle
  }

  var processArguments = $.NSProcessInfo.processInfo.arguments
  for (var i = 0; i < Number(processArguments.count); i += 1) {
    var fromProcessArgument = launcherPathForArgument(ObjC.unwrap(processArguments.objectAtIndex(i)))
    if (fromProcessArgument) return fromProcessArgument
  }
  for (var j = 0; argv && j < argv.length; j += 1) {
    var fromHandlerArgument = launcherPathForArgument(argv[j])
    if (fromHandlerArgument) return fromHandlerArgument
  }
  throw new Error('Could not locate RealmForge launcher resources. Rebuild the app bundle from the project directory.')
}

function launchAction(argv) {
  try {
    var environmentAction = $.NSProcessInfo.processInfo.environment.objectForKey('REALMFORGE_LAUNCHER_ACTION')
    if (environmentAction && ObjC.unwrap(environmentAction) === 'diagnose') return 'diagnose'
  } catch (error) {}
  var processArguments = $.NSProcessInfo.processInfo.arguments
  for (var i = 0; i < Number(processArguments.count); i += 1) {
    var argument = ObjC.unwrap(processArguments.objectAtIndex(i))
    if (argument === 'diagnose') return 'diagnose'
  }
  for (var j = 0; argv && j < argv.length; j += 1) {
    if (String(argv[j]) === 'diagnose') return 'diagnose'
  }
  return 'stop'
}

function run(argv) {
  var application = Application.currentApplication()
  application.includeStandardAdditions = true
  var action = launchAction(argv)
  try {
    var result = application.doShellScript('/bin/zsh ' + shellQuote(launcherPath(argv)) + ' ' + shellQuote(action))
    if (action === 'diagnose') {
      if (ObjC.unwrap($.NSBundle.mainBundle.bundlePath).indexOf('.app') >= 0) {
        console.log(result)
      }
      return result
    }
    application.displayDialog(result, { buttons: ['OK'], defaultButton: 'OK', withTitle: 'RealmForge' })
  } catch (error) {
    application.displayAlert('RealmForge could not stop cleanly', {
      message: String(error),
      as: 'critical',
      buttons: ['OK'],
    })
  }
}
