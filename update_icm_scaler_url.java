import net.gmc.icm.IcmJavaImpl;
import net.gmc.icm.load.IcmClientDllLoader;
import net.gmc.icmjava.*;
import net.gmc.icmjava.input.ConnectionSettings;
import net.gmc.vcs.IVcsClientDll;
import java.io.*;

public class update_icm_scaler_url {
    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "icm";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 30353;
        String user = args.length > 2 ? args[2] : "system";
        String pass = args.length > 3 ? args[3] : "Password12345*";

        try {
            new File("/tmp/icm_upd/cache").mkdirs();
            IVcsClientDll dll = IcmClientDllLoader.getVcsClientDll("/tmp/icm_upd");
            ConnectionSettings s = new ConnectionSettings(host, port, "/tmp/icm_upd/cache", "/tmp/icm_upd/log.txt");
            IcmJava icm = new IcmJavaImpl(dll, s);
            IcmSession session = icm.login(user, pass);
            System.out.println("[+] Connected to ICM successfully!");

            IcmLocation loc = new IcmLocation("icm://Interactive/.config/configuration.json");
            InputStream is = icm.fileDownload(loc, null, session);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int r;
            while ((r = is.read(buf)) != -1) {
                bos.write(buf, 0, r);
            }
            is.close();

            String configContent = bos.toString("UTF-8");
            System.out.println("[*] Current configuration length: " + configContent.length());

            // Replace scaler url
            String newContent = configContent.replaceAll("http://scaler:\\d+(/scaler)?", "http://scaler:30600");
            if (newContent.equals(configContent)) {
                System.out.println("[-] No regex replacement occurred. Replacing exact string...");
                newContent = configContent.replace("30620", "30600");
            }

            System.out.println("[*] New configuration length: " + newContent.length());
            byte[] newBytes = newContent.getBytes("UTF-8");

            boolean ok = icm.fileReplace(new ByteArrayInputStream(newBytes), loc, "Fix scaler URL to container port 30600", session);
            System.out.println("[+] fileReplace result: " + ok);

            icm.logout(session);
            System.out.println("[✓] Finished updating configuration in ICM!");
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }
}
