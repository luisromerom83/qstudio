import net.gmc.icm.IcmJavaImpl;
import net.gmc.icm.load.IcmClientDllLoader;
import net.gmc.icmjava.IcmJava;
import net.gmc.icmjava.IcmLocation;
import net.gmc.icmjava.IcmSession;
import net.gmc.icmjava.input.ConnectionSettings;
import net.gmc.vcs.IVcsClientDll;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

public class fix_interactive_config {
    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "icm";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 30353;
        String user = args.length > 2 ? args[2] : "system";
        String pass = args.length > 3 ? args[3] : "Password12345*";
        String filePath = args.length > 4 ? args[4] : "/work/clean_config.json";

        try {
            System.out.println("[*] Connecting to ICM at " + host + ":" + port + "...");
            new File("/tmp/icm_fix/cache").mkdirs();
            IVcsClientDll dll = IcmClientDllLoader.getVcsClientDll("/tmp/icm_fix");
            ConnectionSettings settings = new ConnectionSettings(host, port, "/tmp/icm_fix/cache", "/tmp/icm_fix/log.txt");
            IcmJava icm = new IcmJavaImpl(dll, settings);
            IcmSession session = icm.login(user, pass);
            System.out.println("[+] Connected to ICM successfully!");

            IcmLocation loc = new IcmLocation("icm://Interactive/.config/configuration.json");
            File f = new File(filePath);
            try (InputStream is = new FileInputStream(f)) {
                System.out.println("[*] Replacing icm://Interactive/.config/configuration.json with " + filePath + " (" + f.length() + " bytes)...");
                boolean ok = icm.fileReplace(is, loc, "Fix scaler duplicate servers and encryption tag mismatch", session);
                System.out.println("[+] fileReplace result: " + ok);
            }

            icm.logout(session);
            System.out.println("[✓] Finished updating configuration in ICM!");
        } catch (Exception e) {
            System.err.println("[ERROR] " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
}
