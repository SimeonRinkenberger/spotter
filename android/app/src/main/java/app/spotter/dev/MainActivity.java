package app.spotter.dev;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(SpotterAndroid.class);
        registerPlugin(GoogleAuth.class);
        registerPlugin(PumpyStream.class);
        registerPlugin(SecureSession.class);
        super.onCreate(state);
    }
}
