import net.gmc.icm.IcmJavaImpl;
import net.gmc.icm.load.IcmClientDllLoader;
import net.gmc.icmjava.IcmJava;
import net.gmc.icmjava.IcmSession;
import net.gmc.icmjava.input.ConnectionSettings;
import net.gmc.vcs.IVcsClientDll;
import net.gmc.vcs.UserProperties;
import java.io.File;

public class grant_impersonation {
    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "localhost";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 30353;
        String user = args.length > 2 ? args[2] : "system";
        String pass = args.length > 3 ? args[3] : "Password12345*";

        try {
            System.out.println("[*] Conectando a ICM en " + host + ":" + port + " con usuario '" + user + "'...");
            new File("/tmp/icm/cache").mkdirs();
            IVcsClientDll dll = IcmClientDllLoader.getVcsClientDll("/tmp/icm");
            ConnectionSettings settings = new ConnectionSettings(host, port, "/tmp/icm/cache", "/tmp/icm_library.log");
            IcmJava icm = new IcmJavaImpl(dll, settings);
            IcmSession session = icm.login(user, pass);
            System.out.println("[+] Sesión iniciada en ICM exitosamente.");

            UserProperties[] props = new UserProperties[] {
                UserProperties.USER_IS_ADMIN,
                UserProperties.USER_ALLOW_IMPERSONATE,
                UserProperties.USER_SERVER_EXPORT_IMPORT,
                UserProperties.USER_PASSWORD_NEVER_EXPIRES,
                UserProperties.USER_CHANGE_SET_CREATE,
                UserProperties.USER_CHANGE_SET_CLOSE,
                UserProperties.USER_CHANGE_SET_APPROVE,
                UserProperties.USER_CHANGE_SET_REJECT,
                UserProperties.USER_CHANGE_SET_INVALIDATE,
                UserProperties.USER_CHANGE_SET_REMOVE,
                UserProperties.USER_CHANGE_SET_IMPORT,
                UserProperties.USER_CHANGE_SET_EXPORT,
                UserProperties.USER_CHANGE_SET_LIST_AND_VIEW,
                UserProperties.USER_CHANGE_SET_EDIT
            };

            for (UserProperties prop : props) {
                boolean ok = icm.setUserProperty(user, prop.getValue(), true, session);
                System.out.println("  -> " + prop.name() + ": " + (ok ? "OK" : "FALLÓ"));
            }

            icm.logout(session);
            System.out.println("[✓] Todos los permisos requeridos por Scaler fueron otorgados.");
        } catch (Exception e) {
            System.err.println("[ERROR] " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
}
