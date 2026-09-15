import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result = spawnSync('./gradlew', process.argv.slice(2).length ? process.argv.slice(2) : ['assembleDebug', 'lintDebug', 'testDebugUnitTest'], {
  cwd: 'android', stdio: 'inherit', env: { ...process.env,
    JAVA_HOME: process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    ANDROID_HOME: process.env.ANDROID_HOME || '/Users/simeon/Library/Android/sdk',
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || resolve('.native-build/gradle')
  }
});
process.exit(result.status ?? 1);
