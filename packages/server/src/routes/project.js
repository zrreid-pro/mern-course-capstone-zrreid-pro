const express = require('express');
const mongoose = require('mongoose');
const chalk = require('chalk');
const { Project, User, Task } = require('../models/index');
const { requireAuth } = require('../middleware/index');

const toId = mongoose.Types.ObjectId;

const router = express.Router();

// @GET /api/project - Private (retrieve all projects)
// TODO Delete later. for testing purposes only
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const uid = req.user._id;

    console.log('REQ.USER', req.user);

    let user = await User.findOne({ _id: uid });

    if (!user) {
      return res.status(401).json({ error: 'You must be logged in.' });
    }

    const populateQuery = [{ path: 'user', select: 'project_list' }];

    const projectsIds = user.project_list;

    projectsIds.forEach(async (projectId) => {});

    const projects = await Project.find({});
    // .sort({ created: -1 })
    // .populate(populateQuery)
    // .exec();

    if (!projects) {
      return res.status(404).send('There are no projects yet.');
    }
    res.status(200).json({ projects, user });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error.');
  }
});

// @GET /api/project:pid - Private (retrieve a specific project)
router.get('/:pid', requireAuth, async (req, res) => {
  const populateQuery = [
    { path: 'users', select: [ '_id', 'username', 'avatar' ] },
    { path: 'tasks', select: ['_id', 'objective', 'status', 'tags', 'assigned_user' ], 
        populate: { path: 'assigned_user', select: [ '_id', 'username', 'avatar' ] }
    }
  ];

  // console.log(req.params.pid);

  const project = await Project.findById(toId(req.params.pid))
    .populate(populateQuery).exec();

  if(project) {
    return res.status(200).json(project);
  } else {
    return res.status(404).json({ error: 'Project does not exist' });
  }



  // try {
  //   const { pid } = req.params;
  //   const uid = req.user._id;

  //   const project = await Project.findOne({ _id: pid });

  //   // validation: if there is no project, return 404
  //   if (!project) {
  //     return res.status(404).json({ error: 'Project does not exist.' });
  //   }

  //   //validation: only users from project's users list can have access to the project
  //   if (!JSON.stringify(project.users).includes(JSON.stringify(uid))) {
  //     return res.status(401).json({ error: 'You do not have access.' });
  //   }

  //   return res.status(200).json(project);
  // } catch (error) {
  //   res.status(500).send('Server Error.');
  //   console.error(error.message);
  // }
});

// @POST /api/project - Private (create a new project)

//TODO
// 1. add validation: if project exists > return 400
// 2. validate tags (unique = true) on the backend

router.post('/', requireAuth, async (req, res) => {
  const { title, description, owner, status_categories, tags, users, tasks } = req.body;
  // console.log(title, description, owner, status_categories, tags, users, tasks);
  
  const populateQuery = [
    { path: 'users', select: [ '_id', 'username', 'avatar' ] },
    { path: 'tasks', select: [ '_id', 'objective', 'status', 'tags', 'assigned_user' ], 
      populate: { path: 'assigned_user', select: [ '_id', 'username', 'avatar' ] }
    }
  ];

  try {
    const project = new Project({
      title: title,
      description: description,
      owner: owner,
      status_categories: status_categories,
      tags: tags,
      users: users,
      tasks: tasks
    });
  
    const savedProject = await project.save();

    const populated = await Project.findById(savedProject._id)
      .populate(populateQuery).exec();

    try {
      for(let i=0; i < users.length; i++) {
        await User.findByIdAndUpdate(
          { _id: users[i] },
          { $push: { project_list: savedProject._id } },
          { new: true }
        );
      }
      
    } catch (error) {
      console.log(
        chalk.red(`Failed to update the project_list field of user id: ${users[i]}`)
      );
    }
    
  
    res.status(200).json(populated);

  } catch (error) {
    console.log(
      chalk.red('Project Creation Failure:', error)
    );
    res.status(500).json({ message: 'Project Creation Failure'});
  }
});

router.put('/:pid/description', requireAuth, async (req, res) => {
  const { description } = req.body;
  const { pid } = req.params;

  try {
    await Project.findByIdAndUpdate(
      { _id: pid },
      { description: description },
      { new: true }
    );

    return res.status(200).send('Description updated');
  } catch (error) {
    console.log(
      chalk.red('Description Update Error:', error)
    );
    res.status(500).json({ message: 'Project Description Failure'});
  }
});

router.put('/:pid/users', requireAuth, async (req, res) => {
  const { users } = req.body;
  const { pid } = req.params;

  try {
    const project = await Project.findById(pid);
    project.users.push(...users);
    project.save();
    

    for(let i=0; i<users.length; i++) {
      await User.findByIdAndUpdate(
        { _id: users[i] },
        { $push: { project_list: pid }},
        { new: true }
      );
    }

    return res.status(200).send('Users updated');
  } catch (error) {
    console.log(
      chalk.red('Users Update Error:', error)
    );
    res.status(500).json({ message: 'Project Users Update Failure'});
  }
});

router.put('/:pid/users/remove', requireAuth, async (req, res) => {
  const { uid } = req.body;
  const { pid } = req.params;

  try {
    // const project = await Project.findById(pid);
    // project.users.push(...users);
    // project.save();
    const project = await Project.findByIdAndUpdate(
      { _id: pid },
      { $pull: { users: uid } },
      { new: true }
    );

    const tasks = await Task.find({ project: pid, assigned_user: uid });

    //Unassigns removed user from any project tasks they were assigned to
    await Task.updateMany(
      { project: pid, assigned_user: uid },
      { $unset: { assigned_user: '' } }
    );

    // console.log('Tasks', tasks)
    let removedUser;
    if(tasks.length === 1) {
      console.log(chalk.yellow('1'))
      removedUser = await User.findByIdAndUpdate(
        { _id: uid },
        {
          $pull: { project_list: pid },
          $pull: { task_list: tasks._id }
        },
        { new: true }
      );
    } else if(tasks.length > 1) {
      // console.log(chalk.yellow('2'))
      removedUser = await User.findById(uid);
      //Removes project tasks from removed user's task_list
      // const newTasks = removedUser.task_list.filter((task) => !tasks.some((item) => item._id === task._id));
      // let task = removedUser.task_list[4];
      // console.log(chalk.red('Current Task:', task))
      // let result = tasks.some((item) => {
      //   console.log(chalk.yellow('Checking Task:', item))
      //   if(task.toString().includes(item._id.toString())) { console.log(chalk.green("That's a match")); return true; }
      //   else { return false; }
      // })
      // console.log(chalk.green(result))

      const newTasks = removedUser.task_list.filter((task) => {
        // console.log(chalk.red('Current Task:', task))
        if(!tasks.some((item) => {
          // console.log(chalk.yellow('Checking Task:', item))
          if(task.toString().includes(item._id.toString())) { return true; }
          else { return false; }
        })) { return true; }
        else { return false; }
      });
      // console.log(chalk.green(newTasks))
      removedUser.task_list = newTasks;
      //Removes project from removed user's project_list
      const newProjects = removedUser.project_list.filter((project) => !pid.toString().includes(project._id.toString()));
      // console.log(chalk.green(newProjects))
      removedUser.project_list = newProjects;
      removedUser.save();
    } else {
      console.log(chalk.yellow('3'))
      removedUser = await User.findByIdAndUpdate(
        { _id: uid },
        {
          $pull: { project_list: pid }
        },
        { new: true }
      );
    }
    
    // const removedUser = await User.findById(uid);

    // //Removes project tasks from removed user's task_list
    // const newTasks = removedUser.task_list.filter((task) => !tasks.some((item) => item._id === task._id));
    // removedUser.task_list = newTasks;

    // //Removes project from removed user's project_list
    // const newProjects = removedUser.project_list.filter((project) => project._id !== pid);
    // removedUser.project_list = newProjects;

    // removedUser.save();
    // await User.findByIdAndUpdate(
    //   { _id: user },
    //   { $pull: { project_list: pid }, task_list: newTasks },
    //   { new: true }
    // );
    return res.status(200).json(removedUser);
    // return res.status(200).send('User removed');
  } catch (error) {
    console.log(
      chalk.red('User Removal Error:', error)
    );
    res.status(500).json({ message: 'Project User Removal Failure'});
  }
});

// @PUT /api/project/:pid/category - Private (update the categories list of the specific project)
router.put('/:pid/category', requireAuth, async (req, res, next) => {
  try {
    const { pid } = req.params;
    const uid = req.user._id;
    const { categories } = req.body;

    let project = await Project.findById({ _id: pid });
    if (!project) {
      return res.status(404).send('This project does not exist.');
    }

    // validation: only the owner can delete the project
    if (JSON.stringify(project.owner) !== JSON.stringify(uid)) {
      return res.status(401).json({
        error:
          'You do not have permission to edit the project categories list.',
      });
    }

    // validation: you cannot pass an empty object
    if (!categories || categories.length < 1) {
      return res
        .status(400)
        .json({ error: 'Please send a valid categories update request.' });
    }

    // update the project categories
    const projectUpdate = await Project.findByIdAndUpdate(
      { _id: pid },
      {
        categories,
      },
      { new: true }
    );

    res.status(200).json({
      msg: 'Project categories have been successfully updated.',
      projectUpdate,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error.');
  }
});

// // @PUT /api/project:pid/user - Private (update the user list of the specific project)
// router.put('/:pid/user', requireAuth, async (req, res, next) => {
//   try {
//     const { pid } = req.params;
//     const uid = req.user._id;
//     const { users } = req.body;

//     let project = await Project.findById({ _id: pid });
//     if (!project) {
//       return res.status(404).send('This project does not exist.');
//     }
//     // validation: only the owner can delete the project
//     if (JSON.stringify(project.owner) !== JSON.stringify(uid)) {
//       return res.status(401).json({
//         error: 'You do not have permission to edit the project user list.',
//       });
//     }

//     // validation: you cannot pass an empty object
//     if (!users || users.length < 1) {
//       return res
//         .status(400)
//         .json({ error: 'Please send a valid users update request.' });
//     }

//     //validation: no one can delete the project owner from the project's users list
//     if (!JSON.stringify(users).includes(JSON.stringify(project.owner))) {
//       return res.status(401).json({
//         error: "You cannot modify the owner's access of this project.",
//       });
//     }

//     // update the project
//     const projectUpdate = await Project.findByIdAndUpdate(
//       { _id: pid },
//       {
//         users,
//       },
//       { new: true }
//     );

//     res
//       .status(200)
//       .json({ msg: 'User list has been successfully updated.', projectUpdate });
//   } catch (error) {
//     console.error(error);
//     res.status(500).send('Server Error.');

//     // next(error);
//   }
// });

// @DELETE /api/project:pid/ - Private (deletes the specified project, its task list and the specified project from the user's project list)
router.delete('/:pid', requireAuth, async (req, res) => {
  try {
    const { pid } = req.params;

    const uid = req.user._id;

    let project = await Project.findById({ _id: pid });
    if (!project) {
      return res.status(404).send('This project does not exist.');
    }

    // validation: only the owner can delete the project
    if (JSON.stringify(project.owner) !== JSON.stringify(uid)) {
      return res.status(401).json({ error: 'You do not have permission.' });
    }

    // delete specified project from the user's project list
    let user = await User.findById(uid);
    user.project_list = user.project_list.splice(
      user.project_list.indexOf(pid),
      1
    );
    user.save();
    // delete task list assosiated with the project, if any
    if (project.tasks.length > 0) {
      project.tasks.forEach(async (task) => {
        let tid = task._id;

        const removedTask = await Task.deleteOne({ _id: tid });
      });
    }

    const removedProject = await project.deleteOne({ _id: pid });

    res.status(200).json({ msg: 'Project deleted', removedProject });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error.');
  }
});

module.exports = router;
