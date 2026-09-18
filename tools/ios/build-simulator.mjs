import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

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
// keychain, nothing bought or fetched. The signature Xcode then applies to a
// Simulator build is still ad-hoc ("Sign to Run Locally") — what the team id
// buys is the .xcent beside it, the "Simulated" entitlement set Xcode derives
// from App/Share.entitlements (application-identifier and the app's own keychain
// group). That is what securityd wants to see; without a team there is no
// .xcent, and every SecItem call comes back errSecMissingEntitlement. Re-signing
// a finished .app by hand does not reproduce it, which is why the signing has to
// happen inside the build rather than after it.
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

// Where the build products go, which signing turned into a real question.
//
// This checkout sits on an iCloud-synced Desktop, and the file provider stamps
// com.apple.FinderInfo onto every directory it recognises as a bundle — an
// .app or .appex acquires one within seconds of being written. codesign
// refuses to sign anything carrying it ("resource fork, Finder information, or
// similar detritus not allowed"), and stripping the attribute first does not
// help, because it is back before the signing phase reaches the bundle. The
// unsigned build never noticed: it signed nothing.
//
// So derived data moves off the synced volume when the checkout is on one.
// ~/Library is not part of iCloud Desktop & Documents, and the directory is
// named after the checkout so worktrees do not share one. SPOTTER_DERIVED_DATA
// overrides, and anywhere outside Desktop/Documents keeps the historical
// .native-build path that IOS-SETUP.md documents.
function derivedData() {
  if (process.env.SPOTTER_DERIVED_DATA) return process.env.SPOTTER_DERIVED_DATA;
  const here = resolve('.'), home = homedir();
  const synced = existsSync(join(home, 'Library/Mobile Documents/com~apple~CloudDocs')) &&
    [join(home, 'Desktop'), join(home, 'Documents')].some(root => here.startsWith(root + '/'));
  return synced ? join(home, 'Library/Developer/Xcode/DerivedData', 'spotter-' + basename(here)) : '.native-build';
}

const products = join(derivedData(), 'Build/Products/Debug-iphonesimulator');
const r = spawnSync('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derivedData(), ...signing, 'build'], { env, stdio: 'inherit' });
if (!r.status) console.log('\nBuilt ' + join(products, 'App.app'));
process.exit(r.status ?? 1);
