CREATE TABLE tasks (
    task_id text PRIMARY KEY,
    last_seq integer NOT NULL CHECK (last_seq > 0),
    snapshot jsonb NOT NULL
);

CREATE TABLE events (
    task_id text NOT NULL REFERENCES tasks(task_id),
    seq integer NOT NULL CHECK (seq > 0),
    payload jsonb NOT NULL,
    PRIMARY KEY (task_id, seq)
);

CREATE TABLE businesses (
    task_id text NOT NULL REFERENCES tasks(task_id),
    place_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (task_id, place_id)
);

CREATE TABLE calls (
    task_id text NOT NULL,
    call_id text NOT NULL,
    place_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    cost_usd numeric CHECK (cost_usd >= 0),
    PRIMARY KEY (task_id, call_id),
    FOREIGN KEY (task_id, place_id) REFERENCES businesses(task_id, place_id)
);

CREATE TABLE quotes (
    task_id text NOT NULL,
    place_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (task_id, place_id),
    FOREIGN KEY (task_id, place_id) REFERENCES businesses(task_id, place_id)
);

CREATE TABLE comparisons (
    task_id text PRIMARY KEY REFERENCES tasks(task_id),
    payload jsonb NOT NULL
);

-- Reserved for evaluation labels. R3 owns their payload format.
CREATE TABLE labels (
    task_id text NOT NULL,
    call_id text NOT NULL,
    label_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (task_id, call_id, label_id),
    FOREIGN KEY (task_id, call_id) REFERENCES calls(task_id, call_id)
);
