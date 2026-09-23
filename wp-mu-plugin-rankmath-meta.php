<?php
/**
 * Plugin Name: Thomas AI - Rank Math REST Meta
 * Description: Registers Rank Math's meta fields for REST so the AI Content
 * Engine can write and verify them via POST /wp/v2/posts/:id.
 * Install: upload this file to wp-content/mu-plugins/ (create the folder if
 * it doesn't exist). No activation needed — mu-plugins load automatically.
 */

add_action('init', function () {
    $fields = [
        'rank_math_title',
        'rank_math_description',
        'rank_math_focus_keyword',
    ];

    foreach ($fields as $field) {
        register_post_meta('post', $field, [
            'show_in_rest' => true,
            'single' => true,
            'type' => 'string',
            'auth_callback' => function () {
                return current_user_can('edit_posts');
            },
        ]);
    }
});
