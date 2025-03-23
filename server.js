const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Serve static files from the public directory
app.use(express.static("public"));

// Store connected users
const users = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle joining a room
  socket.on("join-room", (roomId, username) => {
    socket.join(roomId);
    users.set(socket.id, { roomId, username });

    // Notify others in the room
    socket.to(roomId).emit("user-connected", socket.id, username);

    // Send list of existing users to the new user
    const roomUsers = Array.from(users.entries())
      .filter(([_, user]) => user.roomId === roomId)
      .map(([id, user]) => ({ id, username: user.username }));
    socket.emit("room-users", roomUsers);
  });

  // Handle WebRTC signaling
  socket.on("offer", (offer, targetId) => {
    socket.to(targetId).emit("offer", offer, socket.id);
  });

  socket.on("answer", (answer, targetId) => {
    socket.to(targetId).emit("answer", answer, socket.id);
  });

  socket.on("ice-candidate", (candidate, targetId) => {
    socket.to(targetId).emit("ice-candidate", candidate, socket.id);
  });

  // Handle chat messages
  socket.on("send-message", (message) => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.roomId).emit("receive-message", {
        senderId: socket.id,
        user: user.username,
        text: message,
      });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      socket
        .to(user.roomId)
        .emit("user-disconnected", socket.id, user.username);
      users.delete(socket.id);
    }
  });
});

// For local development
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// For Vercel
module.exports = app;
