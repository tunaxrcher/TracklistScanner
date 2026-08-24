-- CreateTable
CREATE TABLE `users` (
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NULL,
    `picture` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_login_at` DATETIME(3) NULL,

    PRIMARY KEY (`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_email` VARCHAR(255) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'url',
    `title` VARCHAR(512) NULL,
    `tracks` JSON NULL,
    `updated_at` BIGINT NOT NULL,

    INDEX `idx_user_time`(`user_email`, `updated_at`),
    UNIQUE INDEX `uq_user_url`(`user_email`, `url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recents` ADD CONSTRAINT `recents_user_email_fkey` FOREIGN KEY (`user_email`) REFERENCES `users`(`email`) ON DELETE CASCADE ON UPDATE CASCADE;
