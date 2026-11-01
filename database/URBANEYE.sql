CREATE DATABASE urbaneye
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE urbaneye;

CREATE TABLE users (
    user_id INT NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,

    role ENUM('citizen', 'officer', 'admin') NOT NULL DEFAULT 'citizen',

    department_id INT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id),

    INDEX idx_users_department (department_id),
    INDEX idx_users_role (role)
);


CREATE TABLE departments (
    department_id INT NOT NULL AUTO_INCREMENT,
    department_name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (department_id)
);


CREATE TABLE categories (
    category_id INT NOT NULL AUTO_INCREMENT,
    category_name VARCHAR(100) NOT NULL UNIQUE,

    department_id INT NOT NULL,

    description TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (category_id),

    INDEX idx_categories_department (department_id),

    CONSTRAINT fk_categories_department
        FOREIGN KEY (department_id)
        REFERENCES departments(department_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);


CREATE TABLE issues (
    issue_id INT NOT NULL AUTO_INCREMENT,

    user_id INT NOT NULL,

    category_id INT NULL,

    department_id INT NULL,

    title VARCHAR(200) NOT NULL,

    description TEXT NOT NULL,

    image_url VARCHAR(500) NULL,

    latitude DECIMAL(10,8) NULL,

    longitude DECIMAL(11,8) NULL,

    location_name VARCHAR(255) NULL,

    status ENUM('Pending', 'In Progress', 'Resolved')
        NOT NULL DEFAULT 'Pending',

    priority INT NOT NULL DEFAULT 0,

    ai_category VARCHAR(100) NULL,

    ai_confidence DECIMAL(5,2) NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    resolved_at TIMESTAMP NULL,

    PRIMARY KEY (issue_id),

    INDEX idx_issues_user (user_id),
    INDEX idx_issues_category (category_id),
    INDEX idx_issues_department (department_id),
    INDEX idx_issues_status (status),
    INDEX idx_issues_created (created_at),

    CONSTRAINT fk_issues_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_issues_category
        FOREIGN KEY (category_id)
        REFERENCES categories(category_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    CONSTRAINT fk_issues_department
        FOREIGN KEY (department_id)
        REFERENCES departments(department_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE issue_status_history (
    history_id INT NOT NULL AUTO_INCREMENT,

    issue_id INT NOT NULL,

    old_status ENUM('Pending', 'In Progress', 'Resolved') NULL,

    new_status ENUM('Pending', 'In Progress', 'Resolved') NOT NULL,

    changed_by INT NULL,

    comment TEXT NULL,

    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (history_id),

    INDEX idx_history_issue (issue_id),
    INDEX idx_history_user (changed_by),
    INDEX idx_history_date (changed_at),

    CONSTRAINT fk_history_issue
        FOREIGN KEY (issue_id)
        REFERENCES issues(issue_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_history_user
        FOREIGN KEY (changed_by)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE notifications (
    notification_id INT NOT NULL AUTO_INCREMENT,

    user_id INT NOT NULL,

    issue_id INT NULL,

    title VARCHAR(200) NOT NULL,

    message TEXT NOT NULL,

    notification_type ENUM(
        'status_update',
        'new_issue',
        'assignment',
        'system'
    ) NOT NULL DEFAULT 'system',

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (notification_id),

    INDEX idx_notifications_user (user_id),
    INDEX idx_notifications_issue (issue_id),
    INDEX idx_notifications_read (is_read),

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_notifications_issue
        FOREIGN KEY (issue_id)
        REFERENCES issues(issue_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);


CREATE TABLE votes (
    vote_id INT NOT NULL AUTO_INCREMENT,

    issue_id INT NOT NULL,

    user_id INT NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (vote_id),

    UNIQUE KEY unique_issue_user_vote (issue_id, user_id),

    INDEX idx_votes_issue (issue_id),
    INDEX idx_votes_user (user_id),

    CONSTRAINT fk_votes_issue
        FOREIGN KEY (issue_id)
        REFERENCES issues(issue_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    CONSTRAINT fk_votes_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

ALTER TABLE users
ADD CONSTRAINT fk_users_department
    FOREIGN KEY (department_id)
    REFERENCES departments(department_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

    INSERT INTO departments
    (department_id, department_name, description)
VALUES
    (
        1,
        'Botswana Power Corporation (BPC)',
        'Responsible for electricity generation, transmission and supply.'
    ),
    (
        2,
        'Water Utilities Corporation (WUC)',
        'Responsible for public water supply and wastewater services.'
    ),
    (
        3,
        'Department of Roads',
        'Responsible for national road infrastructure and maintenance.'
    ),
    (
        4,
        'Local District and Town Councils',
        'Responsible for local community services and municipal issues.'
    ),
    (
        5,
        'Department of Road Transport and Safety (DRTS)',
        'Responsible for road transport and road safety services.'
    ),
    (
        6,
        'Waste Management',
        'Responsible for waste collection, disposal and related environmental services.'
    );

INSERT INTO categories
    (category_id, category_name, department_id, description)
VALUES
    (
        1,
        'Pothole',
        3,
        'Reports concerning potholes on roads.'
    ),
    (
        2,
        'Burst Water Pipe',
        2,
        'Reports concerning leaking or burst water pipes.'
    ),
    (
        3,
        'Water Supply',
        2,
        'Reports concerning water supply problems.'
    ),
    (
        4,
        'Illegal Dumping',
        6,
        'Reports concerning illegal dumping of waste.'
    ),
    (
        5,
        'Broken Streetlight',
        1,
        'Reports concerning damaged or non-functioning streetlights.'
    ),
    (
        6,
        'Damaged Road',
        3,
        'Reports concerning damaged or unsafe roads.'
    ),
    (
        7,
        'Blocked Drainage',
        2,
        'Reports concerning blocked drainage or water channels.'
    ),
    (
        8,
        'Other',
        4,
        'Community issues that do not fit another category.'
    );


SHOW TABLES;

SELECT
    department_id,
    department_name
FROM departments
ORDER BY department_id;

SELECT
    c.category_id,
    c.category_name,
    d.department_name
FROM categories c
JOIN departments d
    ON c.department_id = d.department_id
ORDER BY c.category_id;

DESCRIBE users;