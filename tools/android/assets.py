from pathlib import Path
import subprocess
res=Path('android/app/src/main/res')
vector='''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
<path android:fillColor="#FF793F" android:pathData="M31,36 Q27,36 27,40 L27,68 Q27,72 31,72 L33,72 Q37,72 37,68 L37,40 Q37,36 33,36 Z M75,36 Q71,36 71,40 L71,68 Q71,72 75,72 L77,72 Q81,72 81,68 L81,40 Q81,36 77,36 Z M44,49 L64,49 A5,5 0,0 1,64 59 L44,59 A5,5 0,0 1,44 49 Z"/>
<path android:fillColor="#EB541C" android:pathData="M21,43 Q19,43 19,46 L19,62 Q19,65 21,65 L23,65 Q25,65 25,62 L25,46 Q25,43 23,43 Z M85,43 Q83,43 83,46 L83,62 Q83,65 85,65 L87,65 Q89,65 89,62 L89,46 Q89,43 87,43 Z"/>
</vector>'''
(res/'drawable/spotter_mark.xml').write_text(vector)
for name in ['ic_launcher','ic_launcher_round']:
    (res/f'mipmap-anydpi-v26/{name}.xml').write_text('''<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/spotter_mark"/><monochrome android:drawable="@drawable/spotter_mark"/></adaptive-icon>''')
(res/'values/ic_launcher_background.xml').write_text('<resources><color name="ic_launcher_background">#17191B</color></resources>')
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    for name in ['ic_launcher','ic_launcher_round']:
        subprocess.run(['sips','-z',str(size),str(size),'docs/icon.png','--out',str(res/f'mipmap-{density}/{name}.png')],check=True,capture_output=True)
# Remove only Capacitor's generated splash placeholders, which override the base resource.
for p in res.glob('drawable*/splash.png'): p.unlink()
(res/'drawable/splash.xml').write_text('''<layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item android:drawable="@color/ic_launcher_background"/><item android:gravity="center" android:width="160dp" android:height="160dp" android:drawable="@drawable/spotter_mark"/></layer-list>''')
p=res/'values/styles.xml';s=p.read_text().replace('<item name="android:background">@drawable/splash</item>','''<item name="windowSplashScreenBackground">@color/ic_launcher_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/spotter_mark</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>''');p.write_text(s)
print('Generated Spotter launcher, adaptive/monochrome icon and launch screen.')
