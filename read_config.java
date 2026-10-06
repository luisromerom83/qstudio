import net.gmc.icm.IcmJavaImpl;
import net.gmc.icm.load.IcmClientDllLoader;
import net.gmc.icmjava.*;
import net.gmc.icmjava.input.ConnectionSettings;
import net.gmc.vcs.IVcsClientDll;
import java.io.*;

public class read_config {
    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "icm";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 30353;
        try {
            new File("/tmp/icm_r/cache").mkdirs();
            IVcsClientDll dll = IcmClientDllLoader.getVcsClientDll("/tmp/icm_r");
            ConnectionSettings s = new ConnectionSettings(host, port, "/tmp/icm_r/cache", "/tmp/icm_r/log.txt");
            IcmJava icm = new IcmJavaImpl(dll, s);
            IcmSession session = icm.login("system", "Password12345*");
            IcmLocation loc = new IcmLocation("icm://Interactive/.config/configuration.json");
            InputStream is = icm.fileDownload(loc, null, session);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int r;
            while ((r = is.read(buf)) != -1) {
                bos.write(buf, 0, r);
            }
            is.close();
            System.out.println("---CONFIGURATION.JSON START---");
            System.out.println(bos.toString("UTF-8"));
            System.out.println("---CONFIGURATION.JSON END---");
            icm.logout(session);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
