class CustomConnections {
  _collection = new Map();

  add(connectionId, socket) {
    const set = this.setFor(connectionId);
    set.add(socket);
  }

  *entriesFor(connectionId) {
    const set = this.setFor(connectionId);

    for (const socket of set) {
      yield socket;
    }
  }

  delete(connectionId, socket = null) {
    const set = this.setFor(connectionId);

    if (socket) {
      set.delete(socket);
    }

    if (!socket || set.size === 0) {
      this._collection.delete(connectionId);
    }
  }

  setFor(connectionId) {
    if (!this._collection.has(connectionId)) {
      const set = new Set();
      this._collection.set(connectionId, set);
      return set;
    }

    return this._collection.get(connectionId);
  }
}

module.exports = CustomConnections;
