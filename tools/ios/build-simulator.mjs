import { spawnSync } from 'node:child_process';

// Build the shell for the Simulator.
//
// This used to pass CODE_SIGNING_ALLOWED=NO, which is fine for checking that the
// project compiles but produces a binary with no entitlements at all — and the
// Simulator's securityd answers every SecItem call from such a binary with
// errSecMissingEntitlement (-34018). Since the Supabase session moved into the
// Keychain, an unsigned build cannot get past boot, so anything you actually
// want to run has to be signed.
//
// Signing here means a local Apple Development certificate in the login
// keychain, nothing bought or fetched: Xcode turns App/Share.entitlements into a
// "Simulated" entitlement set (application-identifier and the app's own keychain
// group) and signs the Simulator build with it. Re-signing a finished .app
// by hand does not work — the Simulator refuses to spawn an ad-hoc signature
// carrying application-identifier or keychain-access-groups — which is why the
// signing has to happen inside the build rather than after it.
//
// With no certificate on the machine the build still runs unsigned, because
// compiling is most of what CI and a parity check want; the warning says what
// that build cannot do.
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' };

function team() {
  if (process.env.SPOTTER_TEAM_ID) return process.env.SPOTTER_TEAM_ID;
  const found = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  const match = /"Apple Development:[^"]*\(([A-Z0-9]{10})\)"/.exec(found.stdout || '');
  return match ? match[1] : null;
}

const id = team();
const signing = id
  ? ['DEVELOPMENT_TEAM=' + id, 'CODE_SIGN_IDENTITY=Apple Development', 'CODE_SIGN_STYLE=Automatic']
  : ['CODE_SIGNING_ALLOWED=NO'];
if (!id) console.warn('No Apple Development certificate found: building unsigned. The app will compile but cannot launch, because the Keychain refuses an unsigned binary. Set SPOTTER_TEAM_ID to force a team.');

const r = spawnSync('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', '.native-build', ...signing, 'build'], { env, stdio: 'inherit' });
process.exit(r.status ?? 1);
