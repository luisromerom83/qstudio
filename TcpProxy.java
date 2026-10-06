import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;

public class TcpProxy {
    public static void main(String[] args) {
        int localPort = args.length > 0 ? Integer.parseInt(args[0]) : 30354;
        String remoteHost = args.length > 1 ? args[1] : "ips";
        int remotePort = args.length > 2 ? Integer.parseInt(args[2]) : 30354;

        try (ServerSocket serverSocket = new ServerSocket(localPort)) {
            System.out.println("[TcpProxy] Listening on 127.0.0.1:" + localPort + " -> forwarding to " + remoteHost + ":" + remotePort);
            while (true) {
                Socket clientSocket = serverSocket.accept();
                new Thread(() -> handleClient(clientSocket, remoteHost, remotePort)).start();
            }
        } catch (Exception e) {
            System.err.println("[TcpProxy ERROR] " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void handleClient(Socket clientSocket, String remoteHost, int remotePort) {
        try {
            Socket remoteSocket = new Socket(remoteHost, remotePort);
            Thread clientToRemote = new Thread(() -> pipe(clientSocket, remoteSocket));
            Thread remoteToClient = new Thread(() -> pipe(remoteSocket, clientSocket));
            clientToRemote.start();
            remoteToClient.start();
        } catch (Exception e) {
            try { clientSocket.close(); } catch (Exception ignored) {}
        }
    }

    private static void pipe(Socket inSocket, Socket outSocket) {
        try {
            InputStream in = inSocket.getInputStream();
            OutputStream out = outSocket.getOutputStream();
            byte[] buffer = new byte[16384];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
                out.flush();
            }
        } catch (Exception ignored) {
        } finally {
            try { inSocket.close(); } catch (Exception ignored) {}
            try { outSocket.close(); } catch (Exception ignored) {}
        }
    }
}
