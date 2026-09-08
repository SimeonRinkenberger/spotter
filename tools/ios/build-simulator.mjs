import { spawnSync } from 'node:child_process';
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' };
const r = spawnSync('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', '.native-build', 'CODE_SIGNING_ALLOWED=NO', 'build'], { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
